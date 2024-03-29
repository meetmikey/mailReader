var serverCommon = process.env.SERVER_COMMON;

var mongoose = require(serverCommon + '/lib/mongooseConnect').mongoose
  , appInitUtils = require(serverCommon + '/lib/appInitUtils')
  , conf = require(serverCommon + '/conf')
  , async = require('async')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , contactUtils = require(serverCommon + '/lib/contactUtils')
  , fs = require('fs')


var run = function() {

  winston.doInfo('running');

  var data = {};

  //var receiveFile = './data/jdReceive.json';
  //var sentAndCoReceiveFile = './data/jdSentAndCoReceive.json';

  //var receiveFile = './data/sagarReceive.json';
  //var sentAndCoReceiveFile = './data/sagarSentAndCoReceive.json';

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
        , corecipient: 0
        , recipient: receive.value
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
              , corecipient: 0
              , recipient: 0
            }  
          }
          data[contactEmail]['sent'] = sentAndCoReceive.value.sent;
          data[contactEmail]['corecipient'] = sentAndCoReceive.value.corecipient;
          eachCallback();
        }

      }, function(err) {
        if ( err ) {
          winston.handleError(err);

        } else {
          //checkData(data);
          findBadSenders(data);
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

    var sent = datum['sent'];
    var corecipient = datum['corecipient'];
    var recipient = datum['recipient'];
    var ratio = getRatioFromDatum(datum);

    data[key].ratio = ratio;
    var ratioDatum = {
        email: key
      , ratio: ratio
      , sent: sent
      , corecipient: corecipient
      , recipient: recipient
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

var getRatioFromDatum = function(datum) {
  var sent = datum['sent'];
  var corecipient = datum['corecipient'];
  var recipient = datum['recipient'];

  var numerator = sent + corecipient;
  var denominator = recipient;

  var ratio = 0;
  if ( denominator ) {
    ratio = numerator / denominator;
  }
  return ratio;
}

var findBadSenders = function(data) {
  var dataKeys = Object.keys(data);

  async.each(dataKeys, function(key, eachCallback) {
    var datum = data[key];
    var status = 'ok';
    var ratio = getRatioFromDatum(datum);
    if ( contactUtils.isBadContactRatio( datum ) ) {
      status = 'BAD!!'
    }
    winston.doInfo('bad contact: ', {email: key, status: status, ratio: ratio, recipient: datum['recipient']});
  });
}

run();