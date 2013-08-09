var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , async = require('async')
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

exports.handleAttachments = function( message, parsedMail, mail, callback ) {

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('attachmentHandler: handleAttachments...', {mailId: mail._id});

  if ( parsedMail.validAttachments && ( parsedMail.validAttachments.length > 0 ) ) {
    var counter = 0;
    async.forEach( parsedMail.validAttachments, 
      function( parsedMailAttachment, forEachCallback ) {
        counter++;
        parsedMailAttachment.counter = counter;
        attachmentHandler.handleAttachment( message, parsedMailAttachment, parsedMail, mail, forEachCallback );
      },
      function(err) {
        callback(err);
      }
    );
  } else {
    callback();
  }
}

exports.handleAttachment = function( message, parsedMailAttachment, parsedMail, mail, callback ) {

  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }
  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('attachmentHandler: handleAttachment...', {mailId: mail._id});

  // set a default filename if it doesn't exist
  if (! parsedMailAttachment.fileName ) {
    parsedMailAttachment.fileName = "untitled";
  }

  //Filter invalid attachments...
  if ( ! parsedMailAttachment.length || !parsedMailAttachment.contentType) {
    var warnData = {mailId: mail._id, contentType: parsedMailAttachment.contentType};
    winston.doWarn('attachmentHandler: handleAttachment: missing filename or contentType', warnData);
    callback();

  } else {

    attachmentHandler.lookForDuplicateOnThread ( parsedMailAttachment, mail, function (err, duplicateAttachment) {
      if (err) {
        callback (err);
      } else if (duplicateAttachment) {
        attachmentHandler.handleDuplicateOnThread (message, parsedMailAttachment, mail, duplicateAttachment, callback);
      } else {
        attachmentHandler.buildCheckSaveUploadAttachment(message, parsedMailAttachment, parsedMail, mail, callback );
      }
    });

  }
}

exports.buildCheckSaveUploadAttachment = function(message, parsedMailAttachment, parsedMail, mail, callback ) {

  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }
  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  winston.doInfo('attachmentHandler: buildCheckSaveUploadAttachment...', {mailId: mail._id});

  var attachment = attachmentHandler.buildAttachment(message, parsedMailAttachment, mail );
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

        attachment.save( function( mongoSaveErr ) {
          if ( mongoSaveErr ) {

            // duplicate exception from mongo, caused by race condition
            // switch to "update path"
            if (mongoSaveErr.code == 11000) {

              var filter = {
                userId : attachment.userId, 
                gmThreadId : attachment.gmThreadId,
                hash : attachment.hash,
                fileSize : attachment.fileSize
              }

              winston.doWarn ('Duplicate attachment on thread for this user', filter);

              // get the thing that caused the duplicate exception so we can go down the duplicate path
              AttachmentModel.findOne (filter)
                .exec (function (mongoFindErr, dupeAttachment) {
                  if (mongoFindErr) {
                    callback (winston.makeMongoError (mongoFindErr));
                  } else {
                    attachmentHandler.handleDuplicateOnThread (message, parsedMailAttachment, mail, dupeAttachment, callback);
                  }
                });
              
            } else {
              callback( winston.makeMongoError( mongoSaveErr ) );
            }

          } else if ( ! attachment.isPromoted ) {
            callback();

          } else {

            async.parallel ([
              function (asyncCb) {
                indexingHandler.createIndexingJobForDocument(message.isQuick, attachment, false, false, asyncCb );
              },
              function (asyncCb) {
                // once the attachment is saved we can feel save creating a job to thumbnail
                if ( attachmentInfo.isImage 
                  && !(attachmentInfo.attachmentThumbExists || attachmentInfo.attachmentThumbErr || attachmentInfo.attachmentThumbSkip) ) {

                  var thumbnailJob = {
                      cloudPath : cloudStorageUtils.getAttachmentPath( attachmentInfo )
                    , isRollover : false
                    , resourceId : attachmentInfo._id
                    , hash : attachmentInfo.hash
                    , fileSize : attachmentInfo.fileSize
                    , jobType : 'thumbnail'
                    , modelName : 'AttachmentInfo'
                    , isQuick : message.isQuick
                  }

                  if (message.isQuick) {
                    sqsConnect.addMessageToWorkerQuickQueue( thumbnailJob, asyncCb );
                  } else {
                    sqsConnect.addMessageToWorkerQueue( thumbnailJob, asyncCb );                    
                  }


                } else {
                  asyncCb();
                }
              }
            ], function (err) {
              callback (err);
            });

          }


        });
      }
    });
  }
}

exports.inheritAttachmentFromAttachmentInfo = function(attachment, attachmentInfo ) {

  if ( ! attachment ) { winston.doMissingParamError('attachment'); return; }
  if ( ! attachmentInfo ) { winston.doMissingParamError('attachmentInfo'); return; }

  attachment.attachmentThumbExists = attachmentInfo.attachmentThumbExists;
}

exports.getAttachmentInfo = function(attachment, parsedMailAttachment, callback ) {

  if ( ! attachment ) { callback( winston.makeMissingParamError('attachment') ); return; }
  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }

  //winston.doInfo('attachmentHandler: getAttachmentInfo...', {attachmentHash: attachment.hash});

  var filter = {
      hash: attachment.hash
    , fileSize: attachment.fileSize
  }

  var updateSet = { 
    $set: {
        hash: attachment.hash
      , fileSize: attachment.fileSize
      , isImage: attachment.isImage
      , docType: attachment.docType
    }
  };
  
  if (attachment.contentType) {
    updateSet['$set']['contentType'] = attachment.contentType.trim();
  }

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

        } else if ( ( ! previousAttachmentInfo._id ) || ( ! attachmentInfo.isUploaded ) ) {
          //we either just created this attachmentInfo, or we haven't uploaded it before
          attachmentHandler.uploadAttachmentInfoToCloud(attachmentInfo, parsedMailAttachment, callback );
        } else {
          callback( null, attachmentInfo );
        }
      });
    }
  });
}

exports.uploadAttachmentInfoToCloud = function(attachmentInfo, parsedMailAttachment, callback ) {
  if ( ! attachmentInfo ) { callback( winston.makeMissingParamError('attachmentInfo') ); return; }
  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }

  attachmentHandler.uploadToCloud(attachmentInfo, parsedMailAttachment, function(uploadErr) {
    if ( uploadErr ) {
      callback(uploadErr);

    } else {
      attachmentInfo.isUploaded = true;
      attachmentInfo.save( function(mongoErr) {
        if ( mongoErr ) {
          callback( winston.makeMongoError( mongoErr ) );

        } else {
          callback( null, attachmentInfo );
        }
      })
    }
  });
}

exports.lookForDuplicateOnThread = function (parsedMailAttachment, mail, callback) {
  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  var hash = attachmentHandler.getMailAttachmentHash(parsedMailAttachment );
  var fileSize = parsedMailAttachment.length;

  var duplicateSearchCriteria = {
      userId: mail.userId
    , gmThreadId: mail.gmThreadId
    , hash: hash
    , fileSize: fileSize
  }

  AttachmentModel.findOne( duplicateSearchCriteria, function(err, foundAttachment) {
    if ( err ) {
      callback( winston.makeMongoError(err) );

    } else if ( ! foundAttachment ) {
      //No duplicate on this thread, move along...
      callback();
    
    } else {
      callback (null, foundAttachment);

    }
  });
}


exports.handleDuplicateOnThread = function (message, parsedMailAttachment, mail, duplicateAttachment, callback ) {

  if ( mail.sentDate.getTime () <= duplicateAttachment.sentDate.getTime () ) {
    attachmentHandler.updateAttachmentForMail(duplicateAttachment, mail, parsedMailAttachment,
      function(err, updatedAttachment) {
        if ( err ) {
          callback(err);
          
        } else if ( ! updatedAttachment ) {
          callback ();

        } else if ( ! updatedAttachment.isPromoted ) {
          callback();

        } else {
          // mail metadata for attachment was incorrectly attributed to a different mail on this thread, update in the index
          indexingHandler.createIndexingJobForDocument (message.isQuick, updatedAttachment, false, false, callback);
        
        }
      });
  } else {
    callback ();
  }
}

exports.updateAttachmentForMail = function(attachment, mail, parsedMailAttachment, callback ) {
  
  if ( ! attachment ) { callback( winston.makeMissingParamError('attachment') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! parsedMailAttachment ) { callback( winston.makeMissingParamError('parsedMailAttachment') ); return; }

  //winston.doInfo('attachmentHandler: updateAttachmentForMail...');

  var filter = {
      '_id': attachment._id
    , 'sentDate' : {$gte : mail.sentDate}
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
    } else if (!updatedAttachment) {
      callback ();
    } else {

      var invalidateJob = {
        _id : updatedAttachment._id
      }

      sqsConnect.addMessageToCacheInvalidationQueue (invalidateJob, function (err) {
        if (err) {
          callback (err); 
        } else {
          callback(null, updatedAttachment );
        }
      });

    }
  });

}


exports.buildAttachment = function(message, parsedMailAttachment, mail ) {

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
    , isPromoted: attachmentHandler.isPromotable(parsedMailAttachment )
    , hash: attachmentHandler.getMailAttachmentHash(parsedMailAttachment )
    //, image: image //If it's an image itself, we'll set a signedURL on this in the route.
  });

  return attachment;  
}

exports.isPromotable = function(parsedMailAttachment ) {
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

  } else if ( utils.endsWith( parsedMailAttachment.fileName, '.vcf' ) ) { // weird contact card
    return false;

  } else if ( attachmentUtils.isATTFile( parsedMailAttachment.fileName ) ) { //weird ATT00001..txt files
    return false;

  } else if ( attachmentUtils.isAttachmentImage( parsedMailAttachment )
    && ( parsedMailAttachment.length < mailReaderConstants.MIN_IMAGE_FILE_SIZE ) ) {
    return false;
  }
  return true;
}

exports.getMailAttachmentHash = function(parsedMailAttachment ) {
  var hash = utils.getHash( parsedMailAttachment.content, 'sha256');
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

//Adds the buffers to the attachments and validates.  Returns true if valid, false otherwise.
exports.addAttachmentBuffersAndValidate = function(parsedMail, attachmentBuffers ) {
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

  parsedMail.validAttachments = [];

  for ( var i=0; i<parsedMail.attachments.length; i++ ) {
    var parsedMailAttachment = parsedMail.attachments[i];
    var myId = parsedMailAttachment['myId'];
    var isValid = true;

    if ( ! attachmentBuffers[myId] ) {
      winston.doWarn('missing attachment buffer');
      isValid = false;
    }
    parsedMailAttachment.content = attachmentBuffers[myId];
    if ( ! attachmentHandler.validateParsedMailAttachment( parsedMailAttachment ) ) {
      isValid = false;
    }

    if (isValid) {
      parsedMail.validAttachments.push (parsedMail.attachments[i]);
    }

  }

  return true;
}

//Checks the content, its length, and its checksum.
//Returns false if invalid, true if valid.
exports.validateParsedMailAttachment = function(parsedMailAttachment ) {

  if ( ! parsedMailAttachment ) { winston.makeMissingParamError('parsedMailAttachment'); return false; }
  if ( ! parsedMailAttachment.content ) { winston.makeMissingParamError('parsedMailAttachment.content'); return false; }

  var attachmentContentLength = parsedMailAttachment.content.length;
  if ( attachmentContentLength !== parsedMailAttachment.length ) {
    var errorData = {attachmentContentLength: attachmentContentLength, attachmentLength: parsedMailAttachment.length};
    winston.doWarn('parsedMailAttachment content length is invalid', errorData);
    return false;
  }

  var md5Hash = utils.getHash( parsedMailAttachment.content, 'md5' );
  if ( md5Hash !== parsedMailAttachment.checksum ) {
    var errorData = {attachmentMD5Hash: md5Hash, checksum: parsedMailAttachment.checksum};
    winston.doWarn('parsedMailAttachment content md5sum is invalid', errorData);
    return false;
  }

  return true;
}