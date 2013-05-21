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

var recipients = []

var dataFilePath = './test/data/courseworkEmail.txt'

var initActions = [
  appInitUtils.CONNECT_MONGO
];

appInitUtils.initApp( 'badEmailTest', initActions, null, function() {
  badEmailTest.run();  
});


exports.run = function() {

  winston.info('running...');

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
