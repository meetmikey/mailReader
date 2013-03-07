var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , elasticSearchClient = require (serverCommon + '/lib/esConnect').client
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , MailModel = require(serverCommon + '/schema/mail').MailModel;

var indexingHandler = this;

exports.indexAttachment = function(attachment, attachmentBytes, mail, callback) {
  var resourceId = indexingHandler.generateResourceId (attachment)
  winston.info ('indexing: ' + resourceId)

  indexingHandler.indexResource (attachment, attachmentBytes, resourceId, false, function (err) {
    if (err) { return callback (winston.doError ('Could not index resource', err)); }

    indexingHandler.indexResourceMetadata (attachment, mail, resourceId, false, function (err) {
      if (err) { return callback (winston.doError ('Could not index attachment metadata', err)); }

      callback ();
    })
  })

}

exports.indexResource = function (resource, resourceBytes, resourceId, isLink, callback) {
  //winston.info ('indexResource', resourceId)
  var options = {"id" : resourceId}
  var indexData = indexingHandler.getIndexDataForResource (resource, resourceBytes, isLink);

  var updateCallback = function (err, num) {
    if (err) { 
      var logData = {resourceId : resourceId, err: err, isLink : isLink};
      winston.doError ("Could not update indexState for ", logData);
    }
    else if (num === 0) {
      var logData = {resourceId : resourceId, isLink: isLink};
      winston.doWarn ("Zero records affected when updating indexState", logData);
    }
    else {
      winston.info ('updated indexState');
    }
  }

  elasticSearchClient.index('mail', 'resource', indexData, options)
    .on('data', function(data) {
      winston.info (data, {data: data})
      if (isLink) {
        LinkModel.update ({comparableURLHash : resourceId}, 
          {$set : {indexState : "done"}}, updateCallback);
      }
      else {
        AttachmentModel.update ({hash : resource.hash}, 
          {$set : {indexState : "done"}}, updateCallback);
      }

      callback();
    })
    .on('error', function (error) {
      winston.doError("Error: indexingHandler: indexResource: could not index document", error);

      if (isLink) {
        LinkModel.update ({comparableURLHash : resourceId}, 
          {$set : {indexState : "error", indexError : JSON.stringify(error)}}, 
          updateCallback);
      }
      else {
        AttachmentModel.update ({hash : resource.hash}, 
          {$set : {indexState : "error", indexError : JSON.stringify(error)}}, 
          updateCallback);
      }

      callback (error);
    })
    .exec()
}

exports.indexResourceMetadata = function (resource, mail, resourceId, isLink, callback) {
  //winston.doInfo ('indexResourceMetadata', {resourceId : resource._id});
  var options = {"id" : String(resource._id), "parent" : resourceId};
  var indexData = indexingHandler.getIndexDataForResourceMeta (resource, isLink, mail);

  indexHandler.setMailIndexState( mail, 'started' );

  elasticSearchClient.index('mail', 'resourceMeta', indexData, options)
    .on('data', function(data) {
      indexingHandler.setMailIndexState( mail, 'done' );
      callback();
    })
    .on('error', function (error) {
      indexingHandler.setMailIndexState( mail, 'error', JSON.stringify(error) );
      callback (error);
    })
    .exec()
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
      var logData = {mailId : mail._id, err: err, isLink : isLink};
      winston.doError ("Could not update indexState for ", logData);

    } else if (num === 0) {
      var logData = {mailId : mail._id, isLink: isLink};
      winston.doWarn ("Zero records affected when updating indexState", logData);
    }
  });
}

exports.updateResourceMetadata = function (resource, mail, resourceId, isLink, callback) {
  indexingHandler.indexResourceMetadata (resource, mail, resourceId, isLink, callback)
}

exports.generateResourceId = function (attachment) {
  return attachment.hash + '_' + attachment.fileSize
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
