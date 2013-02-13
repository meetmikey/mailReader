var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , async = require('async')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , attachmentHandler = require('./attachmentHandler')
  , linkHandler = require('./linkHandler')


var mailReader = this;

exports.handleMailMessage = function(messageString, callback) {

  //winston.info('mailReader: handleMailMessage...');

  var message = JSON.parse(messageString);
  if ( ! mailReader.validateMessage(message, callback) ) { return; }
  
  var mailS3Path = message.path;
  var userId = message.userId;
  var mailId = message.mailId;
  if ( message._id ) { //temporarily support deprecated _id as mailId
    mailId = message._id;
  }
  
  var mailParser = new MailParser();
  mailParser.on('end', function( parsedMail ) {

    mailReader.processMail( parsedMail, mailId, userId, function(err) {

      if ( err ) { //mail processing failed, so try to mark it 'softFail' as we give up...
        mailReader.setMailReaderState( mailId, 'softFail', function(setMailReaderStateErr) {
          if ( setMailReaderStateErr ) {

            //This is really bad, so go ahead and handle the error here...
            winston.handleError( setMailReaderStateErr );

            //We weren't able to mark the mail 'softFail', so we need to put
            // this message back on the queue...
            callback( err );
          } else {
            //We were able to mark the message 'softFail', so remove it from the queue and keep moving...
            // Is this the right move?
            winston.info('mailReader: handleMailMessage: got error, marked mail softFail', {err: err, mailId: mailId});
            callback();
          }
        });

      } else { //Mail processing succeeded.  Mark the mailReaderState 'done', callback...
        mailReader.setMailReaderState( mailId, 'done', function(setMailReaderStateErr) {
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
  mailReader.downloadMailAndRunParser( mailS3Path, mailParser, callback );
}

exports.downloadMailAndRunParser = function( mailS3Path, mailParser, callback ) {
  s3Utils.getFile( mailS3Path, false, function(err, res) {
    if ( err ) {
      callback( err );
      
    } else if ( ! res ) {
      callback( winston.makeMissingParamError('res') );

    } else {
      res.on('data', function(data) {
        mailParser.write(data);
      });
      res.on('end', function() {
        mailParser.end();
      });
    }
  });
}

//If message is valid, just return true.
//If message is INvalid, invoke the callback and return false.
exports.validateMessage = function(message, callback) {

  //winston.info('mailReader: validateMessage...');

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
  winston.info('mailReader: processMail...', {subject: dirtySubject});

  this.checkAndUpdateMail(parsedMail, mailId, userId, function(err) {
    if ( err ) {
      callback(err);
    } else {
      async.parallel([
        function(parallelCallback) {
          attachmentHandler.uploadAttachments(parsedMail, mailId, userId, parallelCallback );
        }
        , function(parallelCallback) {
          linkHandler.extractLinks(parsedMail, mailId, userId, parallelCallback );
        }], function(err) {
          callback(err);
        }
      );
    }
  });
};

//Check for existing mail, callback with no mailId if duplicate, otherwise save and callback mailId
exports.checkAndUpdateMail = function( parsedMail, mailId, userId, callback ) {

  //winston.info('mailReader: checkAndUpdateMail...');

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
          winston.info('mailReader: checkAndUpdateMail: processing mail with mailReaderState: ' + mailReaderState, {mailId: mailId});

        }
        mailReader.updateMail( parsedMail, mailId, callback );
      }
    }
  });
}

exports.updateMail = function( parsedMail, mailId, callback ) {

  winston.info('mailReader: updateMail...');

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mailId ) { callback( winston.makeMissingParamError('mailId') ); return; }
  
  var updateSet = { $set: {
      messageId: mailUtils.getMessageId( parsedMail )
    , sender: mailUtils.getSender( parsedMail )
    , recipients: mailUtils.getAllRecipients( parsedMail )
    , subject: mailUtils.getDirtySubject( parsedMail.subject )
    , cleanSubject: mailUtils.getCleanSubject( parsedMail.subject )
    , bodyText: mailUtils.getBodyText( parsedMail )
    , bodyHTML: mailUtils.getBodyHTML( parsedMail )
    , numAttachments: mailUtils.getNumAttachments( parsedMail )
    , sentDate: mailUtils.getSentDate( parsedMail )
    , mailReaderState: 'started'
  }};

  MailModel.findOneAndUpdate({_id: mailId}, updateSet, function(err) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      callback();
    }
  });
}

exports.setMailReaderState = function( mailId, state, callback ) {

  //winston.info('mailReader: setMailReaderState...');

  if ( ! mailId ) { callback( winston.makeMissingParamError('mailId') ); return; }
  if ( ! mailId ) { callback( winston.makeMissingParamError('state') ); return; }

  MailModel.findOneAndUpdate( {_id: mailId}, {$set : {mailReaderState: state}},
    function (err, updatedMail) {
      if ( err ) {
        callback( winston.makeMongoError(err) );

      } else if ( ! updatedMail ) {
        callback( winston.makeError('no updated mail') );

      } else {
        callback();
      }
    }
  );
}