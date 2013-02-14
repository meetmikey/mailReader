var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , async = require('async')
  , crypto = require('crypto')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel

var attachmentHandler = this;

exports.uploadAttachments = function( parsedMail, mailId, userId, callback ) {
  if ( parsedMail.attachments && parsedMail.attachments.length ) {
    async.forEach( parsedMail.attachments, 
      function(mailAttachment, forEachCallback) {
        attachmentHandler.uploadAttachment(mailAttachment, parsedMail, mailId, userId, forEachCallback);
      },
      function(err) {
        callback(err);
      }
    );
  } else {
    callback();
  }
}

exports.uploadAttachment = function(mailAttachment, parsedMail, mailId, userId, callback) {
  winston.info('uploadAttachment');

  var filename = mailAttachment.fileName;
  var contentType = mailAttachment.contentType;
  var size = mailAttachment.length;
  var sender = mailUtils.getSender(parsedMail);

  var attachment = new AttachmentModel({
      userId: userId
    , mailId: mailId
    , filename: filename
    , contentType: contentType
    , size: size
    , sentDate: mailUtils.getSentDate( parsedMail )
    , sender: sender
    , recipients: mailUtils.getAllRecipients( parsedMail )
    , mailCleanSubject: mailUtils.getCleanSubject( parsedMail.subject )
    , mailBodyText: mailUtils.getBodyText( parsedMail )
    , mailBodyHTML: mailUtils.getBodyHTML( parsedMail )
    , hash: attachmentHandler.getMailAttachmentHash( mailAttachment )
    //, image: image //If it's an image itself, we'll set a signedURL on this in the route.
  });

  attachmentHandler.isDuplicate( attachment, function( err, isDuplicate ) {
    if ( err ) {
      callback(err);

    } else if ( isDuplicate ) {
      var winstonWarningData = {attachmentId: attachment._id, hash: attachment.hash, mailId: mailId, userId: userId, filename: filename};
      winston.warn('attachmentHandler: uploadAttachment: Duplicate attachment!', winstonWarningData);
      attachmentHandler.saveAttachment(attachment, callback);

    } else {
      attachmentHandler.uploadToS3( attachment, mailAttachment, function(err) {
        if ( err ) {
          callback(err);
        } else {
          attachmentHandler.saveAttachment( attachment, callback );
        }
      });
    }
  });
}

exports.isDuplicate = function( attachment, callback ) {

  if ( ! attachment ) { callback( winston.makeMissingParamError('attachment') ); return; }
  if ( ! attachment.hash ) {
    callback( winston.makeError('missing attachment hash', {attachment: attachment}) );
    return;
  }

  AttachmentModel.findOne({hash: attachment.hash, size: attachment.size}, function(err, foundAttachment) {
    if ( err ) {
      callback( winston.makeMongoErr(err) );

    } else if ( foundAttachment ) {
      callback( null, true );

    } else {
      callback();
    }
  });
}

exports.getMailAttachmentHash = function( mailAttachment ) {
  var shaHash = crypto.createHash('sha256');
  shaHash.update( mailAttachment.content );
  var hash = shaHash.digest('hex');
  if ( ! hash ) {
    winston.warn('attachmentHandler: getMailAttachmentHash: blank hash', {mailAttachment: mailAttachment});
  }
  //winston.info('HASH: ' + hash);
  return hash;
}

exports.uploadToS3 = function(attachment, mailAttachment, callback) {

  var headers = {
    'Content-Type': attachment.contentType,
    "x-amz-server-side-encryption" : "AES256",
    "Content-Disposition" : 'attachment; filename=' + attachment.filename
  }
  var s3Path = s3Utils.getAttachmentS3Path(attachment);
  s3Utils.putBuffer(mailAttachment.content, s3Path, headers, true,
    function(err, res) {
      callback(err);
    }
  );
}

exports.saveAttachment = function(attachment, callback) {
  //winston.info('saving attachment to db...');
  attachment.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      //winston.info('attachment saved');
      callback();
    }
  });
}