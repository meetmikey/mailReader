var conf = require ('../conf')
  , aws = require ('aws-lib')

// See "http://docs.amazonwebservices.com/AWSSimpleQueueService/latest/APIReference/"
// General SQS actions do not require a "path" (CreateQueue, ListQueue, etc)

// Specific Queue options (CreateMessage, DeleteMessage, ReceiveMessage etc)
// need a specific path 
// http://sqs.us-east-1.amazonaws.com/123456789012/testQueue/
// /accountid/queue_name
var mailReaderOptions = {
  "path" : '/' + conf.aws.accountID + '/' + conf.aws.sqsMailReadingQueue
};

var sqsConnect = this;

var mailReaderQueue = aws.createSQSClient(conf.aws.key, conf.aws.secret, mailReaderOptions);

exports.addMessageToQueue = function (queue, message) {
  var messageString = JSON.stringify(message)
  var outbound = {
    MessageBody : messageString  
  }
  queue.call( "SendMessage", outbound, function (err, result ) {
    //console.log('sent message to queue: ', message);
  })
}

exports.getMessageFromQueue = function(queue, callback) {

  //console.log('about to get message...');

  queue.call( "ReceiveMessage", {MaxNumberOfMessages : 1}, function (err, sqsMessage) {
    if ( err ) {
      console.error('Error: getMessageFromQueue: got error from ReceiveMessage: ', err);
      callback(err);
    } else {
      var message = sqsConnect.getSQSMessageAttribute(sqsMessage, 'Body');
      callback(null, message, function(err) {
        if ( err ) {
          console.error('Error: getMessageFromQueue: got error from message handling callback: ', err);
          //console.log('due to error, leaving message on queue...');
        } else {
          var receiptHandle = sqsConnect.getSQSMessageAttribute(sqsMessage, 'ReceiptHandle');
          if ( receiptHandle ) {
            sqsConnect.deleteMessageFromQueue( queue, sqsMessage );
          }
        }
      });
    }
  });
}

exports.getSQSMessageAttribute = function(sqsMessage, attribute) {
  if ( sqsMessage
    && sqsMessage.ReceiveMessageResult 
    && sqsMessage.ReceiveMessageResult.Message
    && sqsMessage.ReceiveMessageResult.Message[attribute] ) {
    return sqsMessage.ReceiveMessageResult.Message[attribute];
  }
  return null;
}

exports.pollQueue = function(queue, handleMessage) {

  //console.log('pollQueue running...');

  sqsConnect.getMessageFromQueue(queue, function(err, message, callback) {
    if ( err ) {
      console.error('Error: pollQueue: received error from getMessageFromQueue: ' + err);
      callback(err);
    } else {
      handleMessage(null, message, function(err) {
        if ( err ) {
          console.error('Error: pollQueue: got error from handleMessage: ', err);
        } else {
          sqsConnect.pollQueue(queue, handleMessage);
        }
        callback(err);
      });
    }
  });
}

exports.deleteMessageFromQueue = function( queue, sqsMessage ) {
  
  var receiptHandle = sqsConnect.getSQSMessageAttribute(sqsMessage, 'ReceiptHandle');

  if ( ! receiptHandle ) {
    console.error('Error: deleteMessageFromQueue: missing receipt handle, sqsMessage: ', sqsMessage );
    return;
  }

  var outbound = {
    ReceiptHandle: receiptHandle
  };
  //console.log('deleting message from queue...', receiptHandle);
  queue.call( "DeleteMessage", outbound, function (err) {
    if ( err ) {
      console.error('Error: deleteMessageFromQueue: got error from DeleteMessage: ', err);
    } else {
      var message = sqsConnect.getSQSMessageAttribute(sqsMessage, 'Body');
      //console.log("deleted message from queue: ", message);
    }
  });
}

exports.pollMailReaderQueue = function( handleMessage ) {
  this.pollQueue( mailReaderQueue, handleMessage );
}