var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , elasticSearchClient = require (serverCommon + '/lib/esConnect').client
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel

var indexingHandler = this;

exports.indexAttachment = function(attachment, attachmentBytes, mail, callback) {
  console.log ('indexing', attachment)
  var resourceId = attachment.hash + '_' + attachment.fileSize
  winston.info ('indexing: ' + attachment.hash + '_' + attachment.fileSize)



  indexingHandler.indexResource (attachment, attachmentBytes, resourceId, false, function (err) {

    indexingHandler.indexEmailMetadata (attachment, mail, resourceId, function (err) {
      callback  ()
    })

  })

}

exports.indexLink = function(link, callback) {
  //TODO: write this...
  callback();
}



exports.indexResource = function (attachment, attachmentBytes, resourceId, isLink, callback) {

  var options = {"id" : resourceId}
  var indexData = {
    'file': attachmentBytes.content.toString('base64'),
    'size' : attachment.fileSize,
    'isLink' : isLink
  }

  elasticSearchClient.index('mail', 'resource', indexData, options)
    .on('data', function(data) {
      console.log(data);
      callback();
    })
    .on('error', function (error) {
      winston.doError("Error: indexResourceHelper: indexResource: could not index document ", error);
      callback (error);
    })
    .exec()

}

exports.indexEmailMetadata = function (attachment, mail, resourceId, callback) {
  var options = {"id" : String(mail._id), "parent" : resourceId}

  var emailBody = mail.bodyText;

  if (!mail.bodyText) {
    emailBody = mail.bodyHTML
  }

  console.log (emailBody)

  var indexData = {
    filename: attachment.filename,
    authorName : mail.sender.name,
    authorEmail : mail.sender.email,
    userId : mail.userId,
    emailBody: emailBody
  }


  elasticSearchClient.index('mail', 'email', indexData, options)
    .on('data', function(data) {
      console.log(data);
      callback();
    })
    .on('error', function (error) {
      winston.doError("Error: indexResourceHelper: indexResource: could not index document ", error);
      callback (error);
    })
    .exec()

}