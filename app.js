// Running this will kick off the loop that checks for new messages in the email queue

var aws = require ('aws-lib')
  , sqsConnect = require('./lib/sqsConnect')


sqsConnect.pollMailReaderQueue( function(err, message, callback) {
  if ( err ) {
    console.error('Error: app got error from mailReader queue: ', err)
  } else {
    console.log('got mailReader message: ', message);
  }
  callback();
});