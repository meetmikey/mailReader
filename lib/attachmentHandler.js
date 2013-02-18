var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , async = require('async')
  , crypto = require('crypto')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , indexingHandler = require ('./indexingHandler')
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel

var attachmentHandler = this;

exports.handleAttachments = function( parsedMail, mail, callback ) {
  if ( parsedMail.attachments && ( parsedMail.attachments.length > 0 ) ) {
    async.forEach( parsedMail.attachments, 
      function( parsedMailAttachment, forEachCallback ) {
        attachmentHandler.handleAttachment( parsedMailAttachment, parsedMail, mail, forEachCallback );
      },
      function(err) {
        callback(err);
      }
    );
  } else {
    callback();
  }
}

exports.handleAttachment = function( parsedMailAttachment, parsedMail, mail, callback ) {
  
  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }
  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('attachmentHandler: handleAttachment...');

  attachmentHandler.checkAndHandleDuplicateOnThread( parsedMailAttachment, parsedMail, mail,
    function( err, isDuplicateOnThread ) {
      if ( err ) {
        callback( err );

      } else if ( isDuplicateOnThread ) {
        callback();

      } else { 
        //Normal case: first time we've seen this attachment on this thread for this user.
        attachmentHandler.buildCheckSaveUploadAttachment( parsedMailAttachment, parsedMail, mail, callback );
      }
    }
  );
}

exports.buildCheckSaveUploadAttachment = function( parsedMailAttachment, parsedMail, mail, callback ) {

  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }
  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  winston.doInfo('attachmentHandler: buildCheckSaveUploadAttachment...');

  var attachment = attachmentHandler.buildAttachment( parsedMailAttachment, mail );
  if ( ! attachment ) {
    callback( winston.makeError('failed to build attachment', {mailId: mail._id}) );

  } else {
    attachmentHandler.isDuplicate( attachment, function( err, isDuplicate ) {
      if ( err ) {
        callback(err);
      } 
      else if ( isDuplicate ) {

        var winstonWarningData = {
          attachmentId: attachment._id, 
          hash: attachment.hash, 
          mailId: mail._id, 
          userId: mail.userId, 
          filename: attachment.filename
        };

        winston.doWarn('attachmentHandler: buildCheckSaveUploadAttachment: Duplicate attachment!', winstonWarningData);
        attachmentHandler.saveAttachment(attachment, function (err) {
          if (err) {return callback (err);}

          // just index email metadata since we've seen the attachment before
          var resourceId = indexingHandler.generateResourceId (attachment);
          indexingHandler.indexEmailMetadata (attachment, mail, resourceId, function (err) {
            console.log ('email metadata indexed',  mail._id)
            callback (err)
          });

        });

      } 
      else {
        attachmentHandler.uploadToS3( attachment, parsedMailAttachment, function(err) {
          if ( err ) {
            callback(err);
          } else {
            console.log ('attachment uploaded to s3')
            attachmentHandler.saveAttachment( attachment, function (err) {
              if (err) { return callback (err); }
              // index full attachment since we've never seen it before
              indexingHandler.indexAttachment (attachment, parsedMailAttachment, mail, function (err) {
                callback(err);
              });
            });


          }
        });
      }
    });
  }
}

exports.checkAndHandleDuplicateOnThread = function( parsedMailAttachment, parsedMail, mail, callback ) {

  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }
  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! mail.userId ) { callback( winston.makeMissingParamError('mail.userId') ); return; }
  if ( ! mail.gmThreadId ) { callback( winston.makeMissingParamError('mail.gmThreadId') ); return; }
  if ( ! mail.gmDate ) { callback( winston.makeMissingParamError('mail.gmDate') ); return; }

  winston.doInfo('attachmentHandler: checkAndHandleDuplicateOnThread...');

  var hash = attachmentHandler.getMailAttachmentHash( parsedMailAttachment );
  var fileSize = parsedMailAttachment.length;

  var duplicateSearchCriteria = {
      userId: mail.userId
    , gmThreadId: mail.gmThreadId
    , hash: hash
    , fileSize: fileSize
  }

  var isDuplicatedOnThread = false;

  AttachmentModel.findOne( duplicateSearchCriteria, function(err, foundAttachment) {
    if ( err ) {
      callback( winston.makeMongoErr(err) );

    } else if ( ! foundAttachment ) {
      //No duplicate on this thread, move along...
      callback(null, isDuplicatedOnThread);

    } else if ( mail.gmDate.getTime() < foundAttachment.gmDate.getTime() ) {
      isDuplicatedOnThread = true;
      var oldMailId = foundAttachment.mailId;

      winston.doInfo('attachmentHandler: checkAndHandleDuplicateOnThread: duplicate found on later message');
      
      attachmentHandler.updateAttachmentForMail( foundAttachment, mail, parsedMailAttachment,
        function(err, updatedAttachment) {
          if ( err ) {
            callback(err);
          } else {
            winston.doInfo ('updateAttachmentForMail callback')
            var resourceId = indexingHandler.generateResourceId (foundAttachment)

            // mail metadata for attachment was incorrectly attributed to a different thread, update in the index
            indexingHandler.updateEmailMetadata (oldMailId, updatedAttachment, mail, resourceId, function (err) {
              callback (err, isDuplicatedOnThread)
            })
          }
        }
      );

    } else {
      isDuplicatedOnThread = true;

      //This attachment already exists on an earlier mail in this thread,
      // so just ignore it and move on...
      winston.doInfo('attachmentHandler: checkAndHandleDuplicateOnThread: duplicate found on earlier message');
      callback(null, isDuplicatedOnThread);
    }
  });
}

exports.updateAttachmentForMail = function( attachment, mail, parsedMailAttachment, callback ) {
  
  if ( ! attachment ) { callback( winston.makeMissingParamError('attachment') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }

  //winston.doInfo('attachmentHandler: updateAttachmentForMail...');

  var updateSet = { $set: {
      mailId: mail._id
    , filename: parsedMailAttachment.fileName
    , contentType: parsedMailAttachment.contentType
    , fileSize: parsedMailAttachment.length
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , mailBodyText: mail.bodyText
    , mailBodyHTML: mail.bodyHTML
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
    , gmDate : mail.gmDate
  }};

  AttachmentModel.findOneAndUpdate({_id : attachment._id}, updateSet, function(err, updatedAttachment) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      callback (null, updatedAttachment)
    }
  });

}

exports.buildAttachment = function( parsedMailAttachment, mail ) {

  if ( ! parsedMailAttachment ) { winston.doMissingParamError('parsedMailAttachment'); return null; }
  if ( ! mail ) { winston.doMissingParamError('mail'); return null; }
  if ( ! mail.userId ) { winston.doMissingParamError('mail.userId'); return null; }

  var attachment = new AttachmentModel({
      userId: mail.userId
    , mailId: mail._id
    , filename: parsedMailAttachment.fileName
    , contentType: parsedMailAttachment.contentType
    , fileSize: parsedMailAttachment.length
    , sentDate: mail.sentDate
    , sender: mail.sender
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , mailBodyText: mail.bodyText
    , mailBodyHTML: mail.bodyHTML
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
    , gmDate : mail.gmDate
    , hash: attachmentHandler.getMailAttachmentHash( parsedMailAttachment )
    //, image: image //If it's an image itself, we'll set a signedURL on this in the route.
  });

  return attachment;  
}

exports.isDuplicate = function( attachment, callback ) {

  if ( ! attachment ) { callback( winston.makeMissingParamError('attachment') ); return; }
  if ( ! attachment.hash ) {
    callback( winston.makeError('missing attachment hash', {attachment: attachment}) );
    return;
  }

  AttachmentModel.findOne({hash: attachment.hash, fileSize: attachment.fileSize}, function(err, foundAttachment) {
    if ( err ) {
      callback( winston.makeMongoErr(err) );

    } else if ( foundAttachment ) {
      callback( null, true );

    } else {
      callback();
    }
  });
}

exports.getMailAttachmentHash = function( parsedMailAttachment ) {
  var shaHash = crypto.createHash('sha256');
  shaHash.update( parsedMailAttachment.content );
  var hash = shaHash.digest('hex');
  if ( ! hash ) {
    winston.doWarn('attachmentHandler: getMailAttachmentHash: blank hash', {parsedMailAttachment: parsedMailAttachment});
  }
  //winston.doInfo('HASH: ' + hash);
  return hash;
}

exports.uploadToS3 = function(attachment, parsedMailAttachment, callback) {

  var headers = {
    'Content-Type': attachment.contentType,
    "x-amz-server-side-encryption" : "AES256",
    "Content-Disposition" : 'attachment; filename=' + attachment.filename
  }
  var s3Path = s3Utils.getAttachmentS3Path(attachment);
  s3Utils.putBuffer( parsedMailAttachment.content, s3Path, headers, true,
    function(err, res) {
      callback(err);
    }
  );
}

exports.saveAttachment = function(attachment, callback) {
  //winston.doInfo('saving attachment to db...');
  attachment.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      //winston.doInfo('attachment saved');
      callback();
    }
  });
}