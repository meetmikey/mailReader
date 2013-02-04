var serverCommon = process.env.SERVER_COMMON;

var winston = require (serverCommon + '/lib/winstonWrapper').winston
  , utils = require(serverCommon + '/lib/utils')
  , async = require('async')

//utils.handleError(utils.makeError('myError'));
//winston.warn('warnTest',{'foo':'bar','meow':'mix'});
//winston.info('infoTest',{'foo':'bar','meow':'mix'});


var f1 = function(callback) {
  callback();
}

var f2 = function(callback) {
  callback();
}

var f3 = function(callback) {
  //callback( utils.makeError('something broke', {foo:'bar'}) );
  //callback( utils.makeError(null) );
  callback( utils.makeResponseError('something broke', 500, 'internal error', {foo:'bar'}) );
  //callback( utils.makeResponseError('something broke');
}

async.waterfall([
    f1
  , f2
  , f3
  ],
  function(err) {
    utils.handleError(err);
  }
)