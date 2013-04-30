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
var azurePath = "rawEmail/516c48fae02a65774700000a/2643173-body.txt";
var userId = "516c48fae02a65774700000a";
var mailId = "516c52d713c0d1669f010ef2";

var dataFilePath = './test/data/quora.txt'
//var dataFilePath = './test/data/googleDocLinkMail.txt'

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
    _id : "516c48fae02a65774700000a",
    email : "sagar@mikeyteam.com"
  })

  user.save (function (err) {
    if (err) { 
      callback (winston.makeMongoError (err));
      return;
    }

    var mail = new MailModel ({
      '_id' : mailId,
      'userId' : userId,
      sentDate : Date.now (),
      uid : 123,
      gmThreadId : '1908308240'
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