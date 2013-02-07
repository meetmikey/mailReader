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
console.log  ('awsPath', awsPath)

knoxClient.putFile(filename, awsPath, headers, 
  function(err, res){
    
    if (err) {
      console.error ('error uploading file', err)
      console.error ('filename:', filename)
    }
    else{
      console.log ('statusCode', res.statusCode)
      if (res.statusCode !== 200) {
        console.log ('non 200 status code', res.statusCode)
      }
      else {
        console.log ('uploaded to s3, add msg to queue', awsPath)
      }

    }

})