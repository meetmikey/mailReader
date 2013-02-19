var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , elasticSearchClient = require (serverCommon + '/lib/esConnect').client
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel

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
  winston.info ('indexResource', resourceId)
  var options = {"id" : resourceId}
  var indexData = indexingHandler.getIndexDataForResource (resource, resourceBytes, isLink);

  elasticSearchClient.index('mail', 'resource', indexData, options)
    .on('data', function(data) {
      console.log(data);
      callback();
    })
    .on('error', function (error) {
      winston.doError("Error: indexingHandler: indexResource: could not index document", error);
      callback (error);
    })
    .exec()

}

exports.indexResourceMetadata = function (resource, mail, resourceId, isLink, callback) {
  winston.doInfo ('indexResourceMetadata', {resourceId : resource._id});
  var options = {"id" : String(resource._id), "parent" : resourceId};
  var indexData = indexingHandler.getIndexDataForResourceMeta (resource, isLink, mail);

  elasticSearchClient.index('mail', 'resourceMeta', indexData, options)
    .on('data', function(data) {
      winston.info('successfully indexed: ' + data);
      callback();
    })
    .on('error', function (error) {
      console.log (error)
      callback (winston.doError("Error: indexResourceHelper: indexResource: could not index document ", {err: error}));
    })
    .exec()

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
  console.log (recipientNames)
  console.log (recipientEmails)

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
    indexData ["url"] = resource.url
    indexData ["isLink"] = true
  }
  else {
    indexData ["filename"] = resource.filename
    indexData ["isLink"] = false
  }

  return indexData
}

exports.getIndexDataForResource = function (resource, resourceBytes, isLink) {

  var indexData = {
    'isLink' : isLink,
  }

  console.log ('resourceBytes', resourceBytes)

  if (!isLink) {
    indexData ['size'] = resource.fileSize
    indexData['file'] = resourceBytes.content.toString('base64')
  }
  else {
    indexData['file'] = new Buffer(resourceBytes).toString('base64')
  }

  return indexData

}

exports.packageDiffbotResponseInHTML = function( diffbotResponse ) {
  var html = '<html><head><title> ';
  html += diffbotResponse.title;
  html += '</title></head><body>';
  html += diffbotResponse.text;
  html += '</body></html>';

  return html;
}