var serverCommon = process.env.SERVER_COMMON;


var mongoose = require(serverCommon + '/lib/mongooseConnect').mongoose
  , appInitUtils = require(serverCommon + '/lib/appInitUtils')
  , conf = require(serverCommon + '/conf')
  , async = require('async')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , contactUtils = require(serverCommon + '/lib/contactUtils')
  , ReceiveMRModel = require(serverCommon + '/schema/contact').ReceiveMRModel
  , linkHandler = require('../lib/linkHandler')

var initActions = [
  appInitUtils.CONNECT_MONGO
];

var userId = '5153c69c13934f3811000006';

appInitUtils.initApp( 'getContactData', initActions, conf, function() {

  var run = function() {

    winston.doInfo('running');

    var ratios = {};

    ReceiveMRModel.find({'_id.userId':userId})
    .select('id _id _id.email _id.userId value')
    .exec( function(err, foundReceiveModels) {
      if ( err ) {
        winston.doMongoError(err);
        cleanup();

      } else {
        async.each( foundReceiveModels, function(foundReceiveModel, eachCallback) {

          winston.doInfo('foundReceiveModel', {foundReceiveModel: foundReceiveModel});

          var contactEmail = foundReceiveModel._id.email;
          contactUtils.getContactData( userId, contactEmail, function(err, contactData) {
            if ( err ) {
              eachCallback( err );

            } else {
              var ratio = linkHandler.getContactRatio( contactData );
              winston.doInfo('ratio', {ratio: ratio, email: contactEmail});
              eachCallback();
            }
          });

        }, function(err) {
          if ( err ) {
            winston.handleError(err);
          }
          cleanup();
        });
      }
    });
  }

  var cleanup = function() {
    mongoose.disconnect();
  }

  run();
});