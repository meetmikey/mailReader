var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , async = require('async')
  , crypto = require('crypto')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , mongoUtils = require(serverCommon + '/lib/mongoUtils')
  , attachmentUtils = require(serverCommon + '/lib/attachmentUtils')
  , utils = require(serverCommon + '/lib/utils')
  , cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , indexingHandler = require (serverCommon + '/lib/indexingHandler')
  , mailReaderConf = require('../conf')
  , sqsConnect = require (serverCommon + '/lib/sqsConnect')
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel
  , AttachmentInfoModel = require(serverCommon + '/schema/attachmentInfo').AttachmentInfoModel
  , mailReaderConstants = require('../constants')

var attachmentHandler = this;

exports.handleAttachments = function( parsedMail, mail, callback ) {

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('attachmentHandler: handleAttachments...', {mailId: mail._id});

  if ( parsedMail.attachments && ( parsedMail.attachments.length > 0 ) ) {
    var counter = 0;
    async.forEach( parsedMail.attachments, 
      function( parsedMailAttachment, forEachCallback ) {
        counter++;
        parsedMailAttachment.counter = counter;
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

  //winston.doInfo('attachmentHandler: handleAttachment...', {mailId: mail._id});

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

  winston.doInfo('attachmentHandler: buildCheckSaveUploadAttachment...', {mailId: mail._id});

  var attachment = attachmentHandler.buildAttachment( parsedMailAttachment, mail );
  if ( ! attachment ) {
    callback( winston.makeError('failed to build attachment', {mailId: mail._id}) );

  } else {
    attachmentHandler.getAttachmentInfo( attachment, parsedMailAttachment, function( err, attachmentInfo ) {
      if ( err ) {
        callback(err);

      } else if ( ! attachmentInfo ) {
        callback( winston.makeError('missing attachmentInfo') );

      } else {
        attachmentHandler.inheritAttachmentFromAttachmentInfo( attachment, attachmentInfo );
        attachmentHandler.saveAttachment(attachment, function (err) {
          if (err) {
            callback( err );

          } else if ( ! attachment.isPromoted ) {
            callback();

          } else {

            // just index metadata since we've seen the attachment before and it must already be in the index
            indexingHandler.createIndexingJobForResourceMeta (attachment, false, function (err) {
              if (err) { winston.handleError (err); }
            });

            //No callback from indexingHandler.  It's all handled internally there.
            callback();
          }
        });
      }
    });
  }
}

exports.inheritAttachmentFromAttachmentInfo = function( attachment, attachmentInfo ) {

  if ( ! attachment ) { winston.doMissingParamError('attachment'); return; }
  if ( ! attachmentInfo ) { winston.doMissingParamError('attachmentInfo'); return; }

  attachment.attachmentThumbExists = attachmentInfo.attachmentThumbExists;
  attachment.attachmentThumbSkip = attachmentInfo.attachmentThumbSkip;
  attachment.attachmentThumbErr = attachmentInfo.attachmentThumbErr;
}

exports.getAttachmentInfo = function( attachment, parsedMailAttachment, callback ) {

  if ( ! attachment ) { callback( winston.makeMissingParamError('attachment') ); return; }
  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }

  winston.doInfo('attachmentHandler: getAttachmentInfo...', {attachmentHash: attachment.hash});

  var filter = {
      hash: attachment.hash
    , fileSize: attachment.fileSize
  }

  var updateSet = { $set: {
      hash: attachment.hash
    , fileSize: attachment.fileSize
    , contentType: attachment.contentType
    , isImage: attachment.isImage
    , docType: attachment.docType
  }};
  
  var options = {
      upsert:true
    , new: false
  }

  AttachmentInfoModel.findOneAndUpdate(filter, updateSet, options, function(err, previousAttachmentInfo) {
    if ( err ) {
      callback( winston.makeMongoError( err ) );

    } else {
      //Lookup the thing we just saved.
      //This seems wasteful, but I'd really like to have the clean attachmentInfo.
      AttachmentInfoModel.findOne(filter, function(err, attachmentInfo) {
        if ( err ) {
          callback(err);

        } else if ( ! attachmentInfo ) {
          callback( winston.makeError('failed to find attachmentInfo we just upserted', filter) );

        } else if ( previousAttachmentInfo ) { //this attachmentInfo was created previously...
          //It should be ok to just callback the previousAttachmentInfo since nothing we upserted should have changed it.
          callback( null, previousAttachmentInfo );

        } else { //we just created this attachmentInfo...
            attachmentHandler.uploadToCloud( attachmentInfo, parsedMailAttachment, function(err) {
            if ( err ) {
              callback(err);

            } else {
              if ( attachmentInfo.isImage ) {

                var thumbnailJob = {
                    cloudPath : cloudStorageUtils.getAttachmentPath( attachmentInfo )
                  , isRollover : false
                  , resourceId : attachmentInfo._id
                  , hash : attachmentInfo.hash
                  , fileSize : attachmentInfo.fileSize
                  , jobType : 'thumbnail'
                  , modelName : 'AttachmentInfo'
                }

                sqsConnect.addMessageToWorkerQueue( thumbnailJob, function( err ) {
                  if (err) {
                    winston.doError ('Could not add thumbnail job to worker queue', {job : thumbnailJob});
                  }
                });
              }

              //Only index things that are promoted.  Right now, promotion decisions are based on the attachmentInfo fields,
              // so it should be the same for all attachments using this attachmentInfo
              if ( attachment.isPromoted ) {
                // index full attachmentInfo since we've never seen it before
                indexingHandler.createIndexingJobForResource (attachmentInfo, false, function (err) {
                  if (err) { winston.handleError (err); }
                });
              }

              //No callback from indexingHandler.  It's all handled internally there.
              callback( null, attachmentInfo );
            }
          });
        }
      });
    }
  });
}


exports.checkAndHandleDuplicateOnThread = function( parsedMailAttachment, parsedMail, mail, callback ) {

  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }
  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! mail.userId ) { callback( winston.makeMissingParamError('mail.userId') ); return; }
  if ( ! mail.gmThreadId ) { callback( winston.makeMissingParamError('mail.gmThreadId') ); return; }
  if ( ! mail.sentDate ) { callback( winston.makeMissingParamError('mail.sentDate') ); return; }

  //winston.doInfo('attachmentHandler: checkAndHandleDuplicateOnThread...', {mailId: mail._id});

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

      //winston.doInfo('attachmentHandler: checkAndHandleDuplicateOnThread: duplicate found on later message');
      
      attachmentHandler.updateAttachmentForMail( foundAttachment, mail, parsedMailAttachment,
        function(err, updatedAttachment) {
          if ( err ) {
            callback(err);
            
          } else if ( ! foundAttachment.isPromoted ) {
            callback( null, isDuplicateOnThread );

          } else {

            // mail metadata for attachment was incorrectly attributed to a different mail on this thread, update in the index
            indexingHandler.createIndexingJobForResourceMeta (updatedAttachment, false, function (err) {
              if (err) { winston.handleError (err); }
            });

            //No callback from indexingHandler.  It's all handled internally there.
            callback( null, isDuplicateOnThread );
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

  var filter = {
      _id: attachment._id
    , shardKey: mongoUtils.getShardKeyHash( attachment.userId )
  };

  var updateSet = { $set: {
      mailId: mail._id
    , filename: parsedMailAttachment.fileName
    , contentType: parsedMailAttachment.contentType
    , isImage: attachmentUtils.isAttachmentImage( parsedMailAttachment)
    , docType : attachmentUtils.getDocType (parsedMailAttachment.contentType)
    , fileSize: parsedMailAttachment.length
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
    , gmMsgHex : mailUtils.getHexValue (mail.gmMsgId)
  }};

  AttachmentModel.findOneAndUpdate( filter, updateSet, function(err, updatedAttachment) {
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
    , isImage: attachmentUtils.isAttachmentImage( parsedMailAttachment )
    , docType : attachmentUtils.getDocType (parsedMailAttachment.contentType)
    , fileSize: parsedMailAttachment.length
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
    , gmMsgHex : mailUtils.getHexValue (mail.gmMsgId)
    , isPromoted: attachmentHandler.isPromotable( parsedMailAttachment )
    , hash: attachmentHandler.getMailAttachmentHash( parsedMailAttachment )
    , shardKey: mongoUtils.getShardKeyHash( mail.userId )
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

  } else if ( utils.endsWith( parsedMailAttachment.fileName, '.p7s' ) ) { // weird crypto key
    return false;

  } else if ( attachmentUtils.isATTFile( parsedMailAttachment.fileName ) ) { //weird ATT00001..txt files
    return false;

  } else if ( attachmentUtils.isAttachmentImage( parsedMailAttachment )
    && ( parsedMailAttachment.length < mailReaderConstants.MIN_IMAGE_FILE_SIZE ) ) {
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

  // TODO: add appropriate index
  AttachmentModel.findOne({hash: attachment.hash, fileSize: attachment.fileSize}, function(err, foundAttachment) {
    if ( err ) {
      callback( winston.makeMongoErr(err) );

    } else if ( foundAttachment ) {
      callback( null, foundAttachment );

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

exports.uploadToCloud = function(attachmentInfo, parsedMailAttachment, callback) {

  var headers = {
    'Content-Type': attachmentInfo.contentType,
    "x-amz-server-side-encryption" : "AES256"
  }

  var path = cloudStorageUtils.getAttachmentPath( attachmentInfo );
  var useGzip = true;
  var useAzure = false;

  cloudStorageUtils.putBuffer (parsedMailAttachment.content, path, headers, useGzip, useAzure, function( err, res ) {
    if ( err ) {
      callback( err );
    
    } else {
      callback();
    }
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

//Adds the buffers to the attachments and validates.  Returns true if valid, false otherwise.
exports.addAttachmentBuffersAndValidate = function( parsedMail, attachmentBuffers ) {
  if ( ! parsedMail ) { winston.doMissingParamError('parsedMail'); return false; }

  var numAttachmentBuffers = 0;
  if ( attachmentBuffers ) {
    numAttachmentBuffers = Object.keys(attachmentBuffers).length;
  }

  //If there are no attachments on the parsedMail, just double-check that we also don't have any buffers,
  // otherwise, we're fine.
  if ( ( ! parsedMail.attachments ) || ( ! ( parsedMail.attachments.length > 0 ) ) ) {
    if ( numAttachmentBuffers > 0 ) {
      winston.doError('attachmentBuffers but no attachments');
      return false;
    }
    return true;
  }

  //Check that attachmentBuffers has the same non-zero number of attachments
  if ( ( ! attachmentBuffers ) || ( numAttachmentBuffers !== parsedMail.attachments.length ) ) {
    winston.doError('different number of attachmentBuffers');
    return false;
  }

  for ( var i=0; i<parsedMail.attachments.length; i++ ) {
    var parsedMailAttachment = parsedMail.attachments[i];
    var generatedFileName = parsedMailAttachment['generatedFileName'];
    if ( ! attachmentBuffers[generatedFileName] ) {
      winston.doError('missing attachment buffer');
      return false;
    }
    parsedMailAttachment.content = attachmentBuffers[generatedFileName];
    if ( ! attachmentHandler.validateParsedMailAttachment( parsedMailAttachment ) ) {
      return false;
    }
  }
  return true;
}

//Checks the content, its length, and its checksum.
//Returns false if invalid, true if valid.
exports.validateParsedMailAttachment = function( parsedMailAttachment ) {

  if ( ! parsedMailAttachment ) { winston.makeMissingParamError('parsedMailAttachment'); return false; }
  if ( ! parsedMailAttachment.content ) { winston.makeMissingParamError('parsedMailAttachment.content'); return false; }

  var attachmentContentLength = parsedMailAttachment.content.length;
  if ( attachmentContentLength !== parsedMailAttachment.length ) {
    var errorData = {attachmentContentLength: attachmentContentLength, attachmentLength: parsedMailAttachment.length};
    winston.doError('parsedMailAttachment content length is invalid', errorData);
    return false;
  }

  var md5Hash = utils.getHash( parsedMailAttachment.content, 'md5' );
  if ( md5Hash !== parsedMailAttachment.checksum ) {
    var errorData = {attachmentMD5Hash: md5Hash, checksum: parsedMailAttachment.checksum};
    winston.doError('parsedMailAttachment content md5sum is invalid', errorData);
    return false;
  }

  return true;
}