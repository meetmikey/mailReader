var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , mailReaderConf = require('../conf')
  , mailReaderConstants = require('../constants')
  , MailParser = require('mailparser').MailParser
  , async = require('async')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , utils = require(serverCommon + '/lib/utils')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , attachmentHandler = require('./attachmentHandler')
  , linkHandler = require('./linkHandler')

var mailReader = this;

exports.handleMailMessage = function(messageString, callback) {

  var message = JSON.parse(messageString);
  winston.doInfo('mailReader: handleMailMessage...', message);

  if ( ! mailReader.validateMessage(message, callback) ) { return; }
  
  var userId = message.userId;
  var rawMailCloudPath = message.path;
  var mailId = message.mailId;
  var inAzure = message.inAzure;

  var mailParser = mailReader.getNewMailParser( mailId, userId, callback, function(err) {
    // only callback in error case since mailReader will kick off
    // and handle the dequeue callback
    if (err) {
      mailReader.markMailReaderAsFail(mailId, 'softFail', userId, err, callback);
    }
  });

  mailUtils.downloadMailAndRunParser( rawMailCloudPath, mailParser, inAzure, function(err)  {
    // only callback in error case since mailReader will kick off
    // and handle the dequeue callback
    if (err) {
      //TODO: handle different types of failures from downloadMailAndRunParser();
      // Some may be soft (cloud download connection timed out), some may be hard (file doesn't exist in cloud).
      mailReader.markMailReaderAsFail(mailId, 'softFail', userId, err, callback);
    }
  });
}

exports.getNewMailParser = function( mailId, userId, mailProcessorCallback, callback ) {
  var mailParser = new MailParser({
    streamAttachments: mailReaderConstants.STREAM_ATTACHMENTS
  });

  var attachmentBuffers = {};
  var parsedMailComplete = null;
  var isDone = false;

  mailParser.on('end', function( parsedMail ) {
    if ( isDone ) {
      winston.doWarn('mailparser ended after already done');

    } else {
      parsedMailComplete = parsedMail;
      if ( ! mailReaderConstants.STREAM_ATTACHMENTS ) {
        isDone = true;
        mailReader.runMailProcessor( parsedMailComplete, mailId, userId, mailProcessorCallback );

      } else {
        if ( ( ! parsedMailComplete.attachments )
          || ( ! ( parsedMailComplete.attachments.length > 0 ) )
          || ( Object.keys(attachmentBuffers).length === parsedMailComplete.attachments.length ) ) {

            isDone = true;
            if ( attachmentHandler.addAttachmentBuffersAndValidate( parsedMailComplete, attachmentBuffers ) ) {
              mailReader.runMailProcessor( parsedMailComplete, mailId, userId, mailProcessorCallback );
            } else {
              callback( winston.makeError('invalid attachments', {mailId: mailId}) );
            }
        } else {
          winston.doWarn('mailparser ended but attachments are still outstanding', {mailId: mailId, attachmentBuffersLength: attachmentBuffers.length, parsedMailCompleteAttachmentsLength: parsedMailComplete.attachments.length});
        }
      }
    }
  });

  mailParser.on('attachment', function( parsedMailAttachment ) {

    if ( ! mailReaderConstants.STREAM_ATTACHMENTS ) {
      winston.doError('received mailparser attachment, but not streaming!', {mailId: mailId});

    } else {
      if ( isDone ) {
        winston.doWarn('attachment streamed after already done', {mailId: mailId});

      } else {
        utils.streamToBuffer( parsedMailAttachment.stream, function(err, attachmentBuffer ) {
          if ( err ) {
            isDone = true;
            callback( err );

          } else {
            var generatedFileName = parsedMailAttachment['generatedFileName'];

            if ( ( ! generatedFileName ) || ( attachmentBuffers[generatedFileName] ) ) {
              isDone = true;
              callback( winston.makeError('invalid or duplicate generatedFileName for attachment', {generatedFileName: generatedFileName}) );

            } else {
              attachmentBuffers[generatedFileName] = attachmentBuffer;
              if ( parsedMailComplete && ( Object.keys(attachmentBuffers).length == parsedMailComplete.attachments.length ) ) {
                winston.doInfo('streamed attachments finished after mailparser');
                isDone = true;
                if ( attachmentHandler.addAttachmentBuffersAndValidate( parsedMailComplete, attachmentBuffers ) ) {
                  mailReader.runMailProcessor( parsedMailComplete, mailId, userId, mailProcessorCallback );
                } else {
                  callback( winston.makeError('invalid attachments', {mailId: mailId}) );
                }
              }
            }
          }
        });
      }
    }
  });

  return mailParser;
}

exports.runMailProcessor = function( parsedMail, mailId, userId, callback ) {
  mailReader.processMail( parsedMail, mailId, userId, function(err) {

    if ( err ) { //mail processing failed, so try to mark it 'softFail' as we give up...
      mailReader.markMailReaderAsFail(mailId, 'softFail', userId, err, callback);
    } else { //Mail processing succeeded.  Mark the mailReaderState 'done', callback...
      mailReader.setMailReaderState( mailId, 'done', userId, function(setMailReaderStateErr) {
        if ( setMailReaderStateErr ) {
          //F.  Hit an error while marking ourselves done.  Unfortunately, we need to call it back.
          callback( setMailReaderStateErr );
        } else {
          callback();
        }
      });
    }
  });
}

exports.markMailReaderAsFail = function( mailId, failState, userId, mailReaderError, callback ) {
  mailReader.setMailReaderState( mailId, failState, userId, function(setMailReaderStateErr) {
    
    if ( setMailReaderStateErr ) {
      //This is really bad, so go ahead and handle the error here...
      winston.handleError( setMailReaderStateErr );

      //So, this is really bad, and we should put this back on the queue for recovery
      // (after we fix whatever disaster is happening)
      callback( mailReaderError );
      
    } else {
      // hardFail = delete from queue, softFail = keep on queue
      if (failState == 'hardFail') {
        winston.handleError (mailReaderError);
        callback ();
      } else {
        callback(mailReaderError);
      }
    }
  });
}

//If message is valid, just return true.
//If message is INvalid, invoke the callback and return false.
exports.validateMessage = function(message, callback) {

  //winston.doInfo('mailReader: validateMessage...');

  if ( ! message ) {
    winston.warn('mailReader: validateMessage: empty message!');
    callback();
    return false;

  } else if ( ! message.path ) {
    callback( winston.makeError('no path in message', {message: message}) );
    return false;

  } else if ( ! message.userId ) {
    callback( winston.makeError('no userId in message', {message: message}) );
    return false;

  } else if ( ! message.mailId ) {
    callback( winston.makeError('no mailId in message', {message: message}) );
    return false;
  }
  return true;
}

exports.processMail = function( parsedMail, mailId, userId, callback ) {

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mailId ) { callback( winston.makeMissingParamError('mailId') ); return; }
  if ( ! userId ) { callback( winston.makeMissingParamError('userId') ); return; }

  winston.doInfo('mailReader: processMail...', {mailId: mailId});

  mailReader.checkAndUpdateMail(parsedMail, mailId, userId, function(err, mail) {
    if ( err ) {
      callback(err);

    } else if ( ! mail ) {
      //This case indicates that we should not continue processing the mail.
      winston.warn('mailReader: processMail: no error, but no mail returned from checkAndUpdateMail', {mailId: mailId, userId: userId});
      callback();

    } else {

      mailUtils.saveMailBody( mail, true, function(err) {
        if ( err ) {
          callback( err );
          return;
        }

        async.parallel([
          function(parallelCallback) {
            attachmentHandler.handleAttachments( parsedMail, mail, parallelCallback );
          }
          , function(parallelCallback) {
            linkHandler.extractLinks( parsedMail, mail, parallelCallback );
        }], function(err) {
          if ( err ) {
            callback(err);
          }
          else {
            callback ();
          }
        });

      });
    }
  });
};

//Check for existing mail, callback with no mailId if duplicate, otherwise save and callback mailId
exports.checkAndUpdateMail = function( parsedMail, mailId, userId, callback ) {

  //winston.doInfo('mailReader: checkAndUpdateMail...');

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mailId ) { callback( winston.makeMissingParamError('mailId') ); return; }
  if ( ! userId ) { callback( winston.makeMissingParamError('userId') ); return; }

  MailModel.findOne({_id: mailId, userId: userId}, function(err, foundMail) {
    if ( err ) {
      callback( winston.makeMongoError(err) );

    } else if ( ! foundMail ) {
      callback( winston.makeError('no mail found', {mailId: mailId, deleteFromQueue : true}) );

    } else if ( foundMail.userId != userId ) {
      callback( winston.makeError('BAD! mail userId does not match', {mailUserId: foundMail.userId, userId: userId}) );

    } else {
      var mailReaderState = foundMail.mailReaderState;
      //possible states: 'started', 'softFail', 'hardFail', 'done'

      if ( ( mailReaderState == 'hardFail' ) || ( mailReaderState == 'done' ) ) {
        //these states should NOT be re-processed
        winston.warn('mailReader: checkAndUpdateMail: processing mail with mailReaderState: ' + mailReaderState, {mailId: mailId});
        callback();

      } else if ( mailReaderState == 'softFail' && foundMail.tries >= mailReaderConstants.MAX_TRIES_MAILREADER ) {
        winston.warn ('mailReader: too many fails: setting state to hardFail', {mailId: mailId});

        mailReader.setMailReaderState( mailId, 'hardFail', userId, function(err) {
          callback (err);
        });

      } else {
        //these states are ok to re-process
        if ( mailReaderState == 'started' ) {
          winston.warn('mailReader: checkAndUpdateMail: processing mail with mailReaderState: ' + mailReaderState, {mailId: mailId});

        } else if ( mailReaderState == 'softFail') {
          winston.doInfo('mailReader: checkAndUpdateMail: processing mail with mailReaderState: ' + mailReaderState, {mailId: mailId});

        }

        mailReader.updateMail( parsedMail, foundMail, callback );
      }
    }
  });
}

exports.updateMail = function( parsedMail, mail, callback ) {

  //winston.doInfo('mailReader: updateMail...');

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  var sentDate = mailUtils.getSentDate( parsedMail );
  if ( mail.gmDate ) {
    sentDate = mail.gmDate;
  }

  var filter = {
      _id: mail._id
  };
  
  var updateSet = { $set: {
      messageId: mailUtils.getMessageId( parsedMail )
    , subject: mailUtils.getDirtySubject( parsedMail.subject )
    , cleanSubject: mailUtils.getCleanSubject( parsedMail.subject )
    , numAttachments: mailUtils.getNumAttachments( parsedMail )
    , sentDate: sentDate
    , mailReaderState: 'started'
  }};

  if ( mailReaderConf.storeMailBody ) {
    updateSet['$set']['bodyText'] = mailUtils.getBodyText( parsedMail );
    updateSet['$set']['bodyHTML'] = mailUtils.getBodyHTML( parsedMail );
  }

  //Sagar's mikeymail code should have already set the sender (and recipients),
  // but let's double check...
  if ( ! mail.sender ) {
    winston.doWarn('mailReader: updateMail: no mail sender!', {mailId: mail._id});
  }

  MailModel.findOneAndUpdate( filter, updateSet, function(err, updatedMail) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      updatedMail.bodyText = mailUtils.getBodyText( parsedMail );
      updatedMail.bodyHTML = mailUtils.getBodyHTML( parsedMail );
      callback(null, updatedMail);
    }
  });
}

exports.setMailReaderState = function( mailId, state, userId, callback ) {

  //winston.doInfo('mailReader: setMailReaderState...');

  if ( ! mailId ) { callback( winston.makeMissingParamError('mailId') ); return; }
  if ( ! state ) { callback( winston.makeMissingParamError('state') ); return; }

  var filter = {
      _id: mailId
  };

  var updateSet = {$set: {
    mailReaderState: state
  }};

  MailModel.update( filter, updateSet, function (err, num) {
    if ( err ) {
      callback( winston.makeMongoError(err) );

    } else if ( num === 0 ) {
      callback( winston.makeError('no updated mail', {mailId: mailId, state: state, userId: userId}) );

    } else {
      callback();
    }
  });
}