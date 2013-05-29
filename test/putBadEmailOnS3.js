var serverCommon = process.env.SERVER_COMMON;

var conf = require (serverCommon + '/conf'),
    fs = require('fs'),
    winston = require (serverCommon + '/lib/winstonWrapper').winston,
    sqsConnect = require(serverCommon + '/lib/sqsConnect'),
    knoxClient = require (serverCommon + '/lib/s3Utils').client;


var filename = '/home/jdurack/Desktop/badMail.txt';

var headers = {
  'Content-Type': 'text/plain'
  , 'x-amz-server-side-encryption' : 'AES256'
};

var awsPath = '/rawEmail/BAD_MAIL.txt';
winston.doInfo('awsPath', {awsPath: awsPath});

knoxClient.putFile(filename, awsPath, headers, 
  function(err, res){
    
    if (err) {
      winston.doError('error uploading file', {err: err, filename: filename});
    }
    else{
      winston.doInfo('statusCode', {statusCode: res.statusCode});
      if (res.statusCode !== 200) {
        winston.doInfo('non 200 status code', {statusCode: statusCode});
      }
      else {
        winston.doInfo('uploaded to s3, add msg to queue', {awsPath: awsPath});
      }

    }

})