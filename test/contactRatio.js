var serverCommon = process.env.SERVER_COMMON;

var mongoose = require(serverCommon + '/lib/mongooseConnect').mongoose
  , appInitUtils = require(serverCommon + '/lib/appInitUtils')
  , conf = require(serverCommon + '/conf')
  , async = require('async')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , contactUtils = require(serverCommon + '/lib/contactUtils')
  , ReceiveMRModel = require(serverCommon + '/schema/contact').ReceiveMRModel
  , linkHandler = require('../lib/linkHandler')
  , fs = require('fs')


var run = function() {

  winston.doInfo('running');

  var data = {};

  var receiveFile = './data/jdReceive.json';
  var sentAndCoReceiveFile = './data/jdSentAndCoReceive.json';

  var receiveData = fs.readFileSync(receiveFile).toString();
  var sentAndCoReceiveData = fs.readFileSync(sentAndCoReceiveFile).toString();

  var receiveJSON = JSON.parse(receiveData);
  var sentAndCoReceiveJSON = JSON.parse(sentAndCoReceiveData);

  async.each( receiveJSON, function(receive, eachCallback) {

    var contactEmail = receive._id.email;
    if ( ! contactEmail ) {
      //winston.doWarn('no email', {receive: receive});
      eachCallback();

    } else {
      data[contactEmail] = {
          sent: 0
        , coreceive: 0
        , receive: receive.value
      };
      eachCallback();
    }

  }, function(err) {
    if ( err ) {
      winston.handleError(err);

    } else {
      async.each( sentAndCoReceiveJSON, function(sentAndCoReceive, eachCallback) {

        var contactEmail = sentAndCoReceive._id.email;
        if ( ! contactEmail ) {
          //winston.doWarn('no email', {sentAndCoReceive: sentAndCoReceive});
          eachCallback();

        } else {
          var dataKeys = Object.keys(data);
          if ( dataKeys.indexOf( contactEmail ) === -1 ) {
            data[contactEmail] = {
                sent: 0
              , coreceive: 0
              , recieve: 0
            }  
          }
          data[contactEmail]['sent'] = sentAndCoReceive.value.sent;
          data[contactEmail]['coreceive'] = sentAndCoReceive.value.corecipient;
          eachCallback();
        }

      }, function(err) {
        if ( err ) {
          winston.handleError(err);

        } else {
          checkData(data);
        }
      });
    }
  });
}

var checkData = function(data) {

  var ratioData = [];

  var dataKeys = Object.keys(data);

  async.each(dataKeys, function(key, eachCallback) {
    var datum = data[key];

    var numerator = datum['sent'];
    var denominator = datum['recieve'];

    var ratio = 0;
    if ( denominator ) {
      ratio = numerator / denominator;
    }
    data[key].ratio = ratio;
    var ratioDatum = {
        email: key
      , ratio: ratio
      , sent: datum.sent
      , coreceive: datum.corecieve
      , receive: datum.recieve
    }
    ratioData.push(ratioDatum);
    eachCallback();
  }, function(err) {
    if ( err ) {
      winston.handleError(err);

    } else {
      ratioData.sort( function(a, b) {
        if ( a.ratio > b.ratio ) {
          return -1;
        } else if ( a.ratio == b.ratio ) {
          return 0;
        }
        return 1;
      });
      winston.doInfo('data', {data:ratioData});
    }
  });
}

run();