var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , mongoUtils = require(serverCommon + '/lib/mongoUtils')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , esUtils = require(serverCommon + '/lib/esUtils')
  , attachmentUtils = require(serverCommon + '/lib/attachmentUtils')
  , elasticSearchClient = require (serverCommon + '/lib/esConnect').client
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel
  , LinkInfoModel = require(serverCommon + '/schema/linkInfo').LinkInfoModel
  , MailModel = require(serverCommon + '/schema/mail').MailModel;

var indexingHandler = this;

exports.indexAttachment = function(attachment, attachmentBytes, mail, callback) {
  var resourceId = attachmentUtils.getFileContentId( attachment );
  winston.info ('indexing: ' + fileContentId)

  indexingHandler.indexResource (attachment, attachmentBytes, resourceId, false, function (err) {
    if (err) { return callback (winston.doError ('Could not index resource', err)); }

    var parentId = resourceId;
    indexingHandler.indexResourceMetadata (attachment, mail, parentId, false, function (err) {
      if (err) { return callback (winston.doError ('Could not index attachment metadata', err)); }

      callback ();
    })
  })

}

exports.indexResource = function (resource, resourceBytes, resourceId, isLink, callback) {

  var indexData = indexingHandler.getIndexDataForResource( resource, resourceBytes, isLink );
  var shardKey = '';
  if ( ! isLink ) {
    shardKey = mongoUtils.getShardKeyHash( resource.userId );
  }

  esUtils.index( 'mail', 'resource', resourceId, indexData, null, function( esUtilsError ) {
    if ( esUtilsError ) {
      if ( isLink ) {
        indexingHandler.markFailStatusForLink( resourceId, esUtilsError.message );
      } else {
        indexingHandler.markFailStatusForAttachment( resource.hash, shardKey, esUtilsError.message );
      }
      callback( winston.makeError('failed to index resource') );

    } else {
      callback();
    }
  });
}

exports.updateCallback = function (err, num) {
  if (err) { 
    var logData = {err: err};
    winston.doError ("Could not update indexState for ", logData);
  }
  else if (num == 0) {
    winston.doError ("Zero records affected when updating indexState");
  }
  else {
    winston.info ('updated indexState');
  }
}

exports.markFailStatusForAttachment = function (hash, shardKey, error) {
  AttachmentModel.update ({hash : hash, shardKey: shardKey},
    {$set : {indexState : "error", indexError : error}}, indexingHandler.updateCallback);
}

exports.markFailStatusForLink = function (comparableURLHash, error) {
  LinkInfoModel.update ({comparableURLHash : comparableURLHash},
   {$set : {indexState : "error", indexError : error}}, indexingHandler.updateCallback);
}

exports.markSuccessStatusForAttachment = function (hash, shardKey) {
  AttachmentModel.update ({hash : hash, shardKey: shardKey},
    {$set : {indexState : "done"}}, indexingHandler.updateCallback);
}

exports.markSuccessStatusForLink = function (comparableURLHash) {
  LinkInfoModel.update ({comparableURLHash : comparableURLHash}, 
    {$set : {indexState : "done"}}, indexingHandler.updateCallback);
}

exports.indexResourceMetadata = function (resource, mail, parent, isLink, callback) {
  //winston.doInfo ('indexResourceMetadata', {parent : resource._id});

  indexingHandler.setMailIndexState( mail, 'started' );
  var indexData = indexingHandler.getIndexDataForResourceMeta (resource, isLink, mail);
  esUtils.index( 'mail', 'resourceMeta', String(resource._id), indexData, parent, function( esUtilsError ) {
    if ( esUtilsError ) {
      indexingHandler.setMailIndexState( mail, 'error', esUtilsError.message );
      callback( winston.makeError('error indexing resourceMeta', {esUtilsError: esUtilsError}) );

    } else {
      indexingHandler.setMailIndexState( mail, 'done' );
      callback();
    }
  });
}

exports.setMailIndexState = function( mail, indexState, indexError ) {

  if ( ! mail ) { winston.doMissingParamError('mail'); return; }
  if ( ! indexState ) { winston.doMissingParamError('indexState'); return; }

  mail.indexState = indexState;

  var updateSet = { $set: {
    indexState: indexState
  }};

  if ( ( indexState == 'error' ) && indexError ) {
    updateSet['$set']['indexError'] = indexError;
  }

  MailModel.update ({_id : mail._id}, updateSet, function( err, num ) {
    if (err) { 
      var logData = {mailId : mail._id, err: err};
      winston.doError ("Could not update indexState for ", logData);

    } else if (num === 0) {
      var logData = {mailId : mail._id};
      winston.doWarn ("Zero records affected when updating indexState", logData);
    }
  });
}

exports.updateResourceMetadata = function (resource, mail, resourceId, isLink, callback) {
  indexingHandler.indexResourceMetadata (resource, mail, resourceId, isLink, callback)
}

exports.getIndexDataForResourceMeta = function (resource, isLink, mail) {
  var emailBody = mail.bodyText;

  if (!mail.bodyText) {
    emailBody = mail.bodyHTML
  }

  var recipientNames = mail.recipients.map (function (rec) { return rec.name})
  var recipientEmails = mail.recipients.map (function (rec) { return rec.email})

  var indexData = {
    authorName : mail.sender.name,
    authorEmail : mail.sender.email,
    recipientNames : recipientNames,
    recipientEmails : recipientEmails,
    userId : mail.userId,
    emailBody: emailBody,
    emailSubject: mail.cleanSubject,
    mailId : mail._id,
    date : mail.gmDate
  }

  if (isLink) {
    indexData ["url"] = resource.url;
    indexData ["isLink"] = true;
  }
  else {
    indexData ["filename"] = resource.filename;
    indexData ["isLink"] = false;
  }

  return indexData
}

exports.getIndexDataForResource = function (resource, resourceBytes, isLink) {

  var indexData = {
    'isLink' : isLink
  }

  if (!isLink) {
    indexData ['size'] = resource.fileSize;
    indexData ['docType'] = resource.docType;
    
    if (!resource.isImage) {
      indexData ['file'] = resourceBytes.content.toString('base64');
    }

  }
  else {
    indexData ['docType'] = resource.docType;
    indexData['file'] = new Buffer(resourceBytes).toString('base64');
  }

  return indexData;

}

exports.packageDiffbotResponseInHTML = function( diffbotResponse ) {
  if ( diffbotResponse ) {
    return indexingHandler.packageInHTML( diffbotResponse.title, diffbotResponse.text );
  }
  return '';
}

exports.packageInHTML = function( title, text ) {

  if ( ( ! title ) && ( ! text ) ) {
    return '';
  }

  var html = '<html><head><title> ';
  html += title;
  html += '</title></head><body>';
  html += text;
  html += '</body></html>';
  return html;
}
