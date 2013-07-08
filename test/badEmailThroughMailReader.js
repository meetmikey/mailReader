var serverCommon = process.env.SERVER_COMMON;

var mongoose = require(serverCommon + '/lib/mongooseConnect')
  , attachmentHandler = require('../lib/attachmentHandler')
  , mailReader = require('../lib/mailReader')
  , cloudStorageUtils = require (serverCommon + '/lib/cloudStorageUtils')
  , fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , UserModel = require(serverCommon + '/schema/user').UserModel
  , appInitUtils = require (serverCommon + '/lib/appInitUtils')


var badEmailTest = this;
var azurePath = "rawEmail/516feea3a42ae2f994000017/2643173-body.txt";
var userId = "5181b78bade2190015000009";
var mailId = "516feea3a42ae2f994000017";
var emailAddress = 'justin@mikeyteam.com';
var sender = {
    name: 'Alexander Rives'
  , email: 'alexrives@gmail.com'
}

var mailObj = {
  "_id" : "51da3311fab1e608e805ab40",
  "bodyInS3" : true,
  "cleanSubject" : "Estimate from Cherish Paperie Darlene Muessig",
  "gmDate" : "2012-07-24T05:30:28Z",
  "gmLabels" : [
    "\\Important",
    "estimates &- inquiries"
  ],
  "gmMsgId" : "1408350634284823063",
  "gmThreadId" : "1408321545939061105",
  "linkExtractorState" : "done",
  "mailReaderState" : "done",
  "mailboxId" : "51d8aa77fab1e608e800096a",
  "messageId" : "<19ee01ce7811$7a420fd0$6ec62f70$@cherishpaperie.com>",
  "mmDone" : true,
  "numAttachments" : 0,
  "recipients" : [
    {
      "name" : "'Darlene Muessig'",
      "email" : "darlenemuessig@hotmail.com"
    }
  ],
  "s3Path" : "rawEmail/51d8aa5b4ef29d2a6b000230/54761-body.txt",
  "sender" : {
    "name" : "Chris Coerper",
    "email" : "chris@cherishpaperie.com"
  },
  "sentDate" : "2012-07-24T05:30:28Z",
  "seqNo" : 54638,
  "size" : 3070,
  "subject" : "RE: Estimate from Cherish Paperie Darlene Muessig",
  "tries" : 2,
  "uid" : 54761,
  "userId" : "51d8aa5b4ef29d2a6b000230"
}


var recipients = []

var dataFilePath = './test/data/myfile'

var initActions = [
  appInitUtils.CONNECT_MONGO
];

appInitUtils.initApp( 'badEmailTest', initActions, null, function() {
  badEmailTest.run();  
});


exports.run = function() {

  winston.doInfo('running...');

  badEmailTest.uploadBadFileToAzure (function (err) {
    if (err) {
      winston.handleError (err);
      process.exit (1);
    } else {

      badEmailTest.setupDatabase (function (err) {
        if (err) {
          winston.handleError (err);
          process.exit (1);
        } else {

          var mailMessage = {
            "userId":userId,
            "path":azurePath,
            "mailId":mailId,
            "inAzure":true
          };

          mailReader.handleMailMessage (JSON.stringify(mailMessage), function (err) {
            if (err) {
              winston.handleError (err);
            }
          });

        }
      });

    }
  });

}


exports.uploadBadFileToAzure = function (callback) {
  fs.readFile( dataFilePath, function(err, data) {
    if ( err ) {
      winston.doError('fs err', {err: err});
    } 
    else{
      cloudStorageUtils.putBuffer(data, azurePath, {}, false, true, callback);
    }
  });
}

exports.setupDatabase = function (callback) {
  var user = new UserModel ({
    _id : userId,
    email : emailAddress
  })

  user.save (function (err) {
    if (err) { 
      callback (winston.makeMongoError (err));
      return;
    }

    var mail = new MailModel ({
        '_id' : mailId
      , 'userId' : userId
      , sentDate : Date.now ()
      , uid : 123
      , gmThreadId : '1908308240'
      , sender: sender
      , recipients : recipients
      , gmDate : "2012-07-24T05:30:28Z",
    });

    mail.save (function (err) {
      if (err) {
        callback (winston.makeMongoError (err));
      } else {
        callback ();
      }
    })

  });


  
}
