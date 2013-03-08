var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , async = require('async')
  , crypto = require('crypto')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , utils = require(serverCommon + '/lib/utils')
  , cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , indexingHandler = require ('./indexingHandler')
  , mailReaderConf = require('../conf')
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel

var attachmentHandler = this;
var isLink = false;

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

  //Filter invalid attachments...
  if ( ( ! parsedMailAttachment.fileName ) || ( ! parsedMailAttachment.length ) ) {
    var warnData = {mailId: mail._id, contentType: parsedMailAttachment.contentType};
    winston.doWarn('attachmentHandler: handleAttachment: missing filename', warnData);
    callback();

  } else {
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

      } else if ( isDuplicate ) {
        var winstonWarningData = {
          attachmentId: attachment._id, 
          hash: attachment.hash, 
          mailId: mail._id, 
          userId: mail.userId, 
          filename: attachment.filename
        };

        winston.doWarn('attachmentHandler: buildCheckSaveUploadAttachment: Duplicate attachment!', winstonWarningData);
        attachmentHandler.saveAttachment(attachment, function (err) {
          if (err) {
            callback (err);

          } else {
            // just index metadata since we've seen the attachment before and it must already be in the index
            var resourceId = indexingHandler.generateResourceId (attachment);
            indexingHandler.indexResourceMetadata(attachment, mail, resourceId, isLink, function (err) {
              callback(err);
            });
          }
        });

      } else {
        attachmentHandler.uploadToS3( attachment, parsedMailAttachment, function(err) {
          if ( err ) {
            callback(err);

          } else {
            attachmentHandler.saveAttachment( attachment, function (err) {
              if (err) {
                callback (err);

              } else {
                // index full attachment since we've never seen it before
                indexingHandler.indexAttachment(attachment, parsedMailAttachment, mail, function (err) {
                  callback(err);
                });
              }
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
  if ( ! mail.sentDate ) { callback( winston.makeMissingParamError('mail.sentDate') ); return; }

  winston.doInfo('attachmentHandler: checkAndHandleDuplicateOnThread...');

  var hash = attachmentHandler.getMailAttachmentHash( parsedMailAttachment );
  var fileSize = parsedMailAttachment.length;

  var duplicateSearchCriteria = {
      userId: mail.userId
    , gmThreadId: mail.gmThreadId
    , hash: hash
    , fileSize: fileSize
  }

  var isDuplicateOnThread = false;

  AttachmentModel.findOne( duplicateSearchCriteria, function(err, foundAttachment) {
    if ( err ) {
      callback( winston.makeMongoErr(err) );

    } else if ( ! foundAttachment ) {
      //No duplicate on this thread, move along...
      callback(null, isDuplicateOnThread);

    } else if ( mail.sentDate.getTime() < foundAttachment.sentDate.getTime() ) {
      isDuplicateOnThread = true;

      winston.doInfo('attachmentHandler: checkAndHandleDuplicateOnThread: duplicate found on later message');
      
      attachmentHandler.updateAttachmentForMail( foundAttachment, mail, parsedMailAttachment,
        function(err, updatedAttachment) {
          if ( err ) {
            callback(err);
          } else {
            winston.doInfo ('updateAttachmentForMail callback')
            var resourceId = indexingHandler.generateResourceId (foundAttachment)

            // mail metadata for attachment was incorrectly attributed to a different mail on this thread, update in the index
            indexingHandler.updateResourceMetadata (updatedAttachment, mail, resourceId, isLink, function (err) {
              if (err) { return callback (err); }
              callback (err, isDuplicateOnThread)
            })
          }
        }
      );

    } else {
      isDuplicateOnThread = true;

      //This attachment already exists on an earlier mail in this thread,
      // so just ignore it and move on...
      winston.doInfo('attachmentHandler: checkAndHandleDuplicateOnThread: duplicate found on earlier message');
      callback(null, isDuplicateOnThread);
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
    , isImage: mailUtils.isContentTypeCandidate( parsedMailAttachment.contentType, 'image' )
    , docType : mailUtils.getDocType (parsedMailAttachment.contentType)
    , fileSize: parsedMailAttachment.length
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
  }};

  AttachmentModel.findOneAndUpdate({_id : attachment._id}, updateSet, function(err, updatedAttachment) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      callback (null, updatedAttachment)
    }
  });

  if ( mailReaderConf.storeMailBody ) {
    updateSet['$set']['mailBodyText'] = mail.bodyText;
    updateSet['$set']['mailBodyHTML'] = mail.bodyHTML;
  }

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
    , isImage: mailUtils.isContentTypeCandidate( parsedMailAttachment.contentType, 'image' )
    , docType : mailUtils.getDocType (parsedMailAttachment.contentType)
    , fileSize: parsedMailAttachment.length
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
    , isPromoted: attachmentHandler.isPromotable( parsedMailAttachment )
    , hash: attachmentHandler.getMailAttachmentHash( parsedMailAttachment )
    //, image: image //If it's an image itself, we'll set a signedURL on this in the route.
  });

  if ( mailReaderConf.storeMailBody ) {
    attachment['mailBodyText'] = mail.bodyText;
    attachment['mailBodyHTML'] = mail.bodyHTML;
  }

  return attachment;  
}

exports.isPromotable = function( parsedMailAttachment ) {
  if ( ! parsedMailAttachment ) {
    return false;

  } else if ( ! parsedMailAttachment.fileName ) {
    return false;

  } else if ( ! parsedMailAttachment.length ) {
    return false;

  } else if ( utils.endsWith( parsedMailAttachment.fileName, '.ics' ) ) { //calendar
    return false;

  }
  return true;
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

  var path = cloudStorageUtils.getAttachmentPath (attachment);

  cloudStorageUtils.putBuffer (parsedMailAttachment.content, path, headers, true, function (err, res) {
    callback (err);
  });

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

