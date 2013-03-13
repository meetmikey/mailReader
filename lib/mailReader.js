var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , mailReaderConf = require('../conf')
  , MailParser = require('mailparser').MailParser
  , async = require('async')
  , cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , mongoUtils = require(serverCommon + '/lib/mongoUtils')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , attachmentHandler = require('./attachmentHandler')
  , linkHandler = require('./linkHandler')

var mailReader = this;

exports.handleMailMessage = function(messageString, callback) {

  //winston.doInfo('mailReader: handleMailMessage...');

  var message = JSON.parse(messageString);
  if ( ! mailReader.validateMessage(message, callback) ) { return; }
  
  var mailS3Path = message.path;
  var userId = message.userId;
  var mailId = message.mailId;
  var inAzure = message.inAzure;

  if ( message._id ) { //temporarily support deprecated _id as mailId
    mailId = message._id;
  }
  
  var mailParser = new MailParser();
  mailParser.on('end', function( parsedMail ) {

    mailReader.processMail( parsedMail, mailId, userId, function(err) {

      if ( err ) { //mail processing failed, so try to mark it 'softFail' as we give up...
        mailReader.setMailReaderState( mailId, 'softFail', userId, function(setMailReaderStateErr) {
          
          if ( setMailReaderStateErr ) {
            //This is really bad, so go ahead and handle the error here...
            winston.handleError( setMailReaderStateErr );

            //So, this is really bad, but we need to just log it and move on.
            winston.handleError( err );
            callback();
            
          } else {
            //We were able to mark the message 'softFail', so remove it from the queue and keep moving...
            // Is this the right move?
            winston.doInfo('mailReader: handleMailMessage: got error, marked mail softFail', {err: err, mailId: mailId});
            callback();
          }
        });

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
  });
  mailReader.downloadMailAndRunParser( mailS3Path, mailParser, inAzure, callback );
}

exports.downloadMailAndRunParser = function( mailS3Path, mailParser, inAzure, callback ) {

  cloudStorageUtils.getFile( mailS3Path, false, inAzure, function(err, res) {
    if ( err ) {
      callback( err );
      
    } else if ( ! res) { // TODO: CHECK STATUS CODE
      callback( winston.makeMissingParamError('res') );

    } else {
      res.on('data', function(data) {
        // data - but data could be something like...
        mailParser.write(data);
      });
      res.on('end', function() {
        mailParser.end();
      });
      res.on('error', function (err) {
        callback (winston.makeError ('Error downloading email from cloud', {err : err}));
      });
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

  } else if ( ( ! message.mailId ) && ( ! message._id ) ) {  //checking ._id only temporarily (deprecated)
    callback( winston.makeError('no mailId in message', {message: message}) );
    return false;
  }
  return true;
}

exports.processMail = function( parsedMail, mailId, userId, callback ) {

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mailId ) { callback( winston.makeMissingParamError('mailId') ); return; }
  if ( ! userId ) { callback( winston.makeMissingParamError('userId') ); return; }

  var dirtySubject = mailUtils.getDirtySubject( parsedMail.subject );
  winston.doInfo('mailReader: processMail...', {subject: dirtySubject});

  mailReader.setMailReaderState( mailId, 'started', userId, function(err) {
    if ( err ) {
      callback(err);

    } else {
      mailReader.checkAndUpdateMail(parsedMail, mailId, userId, function(err, mail) {
        if ( err ) {
          callback(err);

        } else if ( ! mail ) {
          //This case indicates that we should not continue processing the mail.
          winston.warn('mailReader: processMail: no error, but no mail returned from checkAndUpdateMail', {mailId: mailId, userId: userId});
          callback();

        } else {
          async.parallel([
            function(parallelCallback) {
              attachmentHandler.handleAttachments(parsedMail, mail, parallelCallback );
            }
            , function(parallelCallback) {
              linkHandler.extractLinks(parsedMail, mail, parallelCallback );
            }
            , function(parallelCallback) {
              mailReader.saveMailBody(parsedMail, mail, parallelCallback );
            }], function(err) {
              callback(err);
            }
          );
        }
      });
    }
  });
};

exports.saveMailBody = function( parsedMail, mail, callback ) {

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  if ( mail.indexState && ( mail.indexState != 'none' ) ) {
    var mailBody = {
        bodyText: mail.bodyText
      , bodyHTML: mail.bodyHTML
    }

    var buffer = JSON.stringify(mailBody);
    var cloudPath = cloudStorageUtils.getMailBodyPath( mail );
    var options = {};
    var useGzip = true;
    var useAzure = false;

    cloudStorageUtils.putBuffer( buffer, cloudPath, options, useGzip, useAzure, function (err) {
      if (err) {
        var query = {_id : mail._id};

        MailModel.update (query, {$set : {failUploadBody : true}}, function (err, num) {
          if (err) { 
            winston.doError ('could not update model failed to uploadToS3', err); 
          }
          else if (num == 0) {
            winston.doWarn ('Zero records affected when marking failedUploadBody', {query : query, model : 'mail'});
          }
        });        
      }

      callback (err);
    });

  } else {
    callback();
  }
}

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
      callback( winston.makeError('no mail found', {mailId: mailId}) );

    } else if ( foundMail.userId != userId ) {
      callback( winston.makeError('BAD! mail userId does not match', {mailUserId: foundMail.userId, userId: userId}) );

    } else {
      var mailReaderState = foundMail.mailReaderState;
      //possible states: 'none', 'started', 'softFail', 'hardFail', 'done'

      if ( ( mailReaderState == 'hardFail' ) || ( mailReaderState == 'done' ) ) {
        //these states should NOT be re-processed
        winston.warn('mailReader: checkAndUpdateMail: processing mail with mailReaderState: ' + mailReaderState, {mailId: mailId});
        callback();

      } else {
        //these states are ok to re-process
        if ( mailReaderState == 'started' ) {
          winston.warn('mailReader: checkAndUpdateMail: processing mail with mailReaderState: ' + mailReaderState, {mailId: mailId});

        } else if ( mailReaderState == 'softFail' ) {
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
    , shardKey: mongoUtils.getShardKeyHash( mail.userId )
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
    , shardKey: mongoUtils.getShardKeyHash( userId )
  };
  var updateSet = {$set: {
    mailReaderState: state
  }};

  MailModel.findOneAndUpdate( filter, updateSet, function (err, updatedMail) {
    if ( err ) {
      callback( winston.makeMongoError(err) );

    } else if ( ! updatedMail ) {
      callback( winston.makeError('no updated mail') );

    } else {
      callback();
    }
  });
}