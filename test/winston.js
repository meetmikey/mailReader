var serverCommon = process.env.SERVER_COMMON;

var winston = require (serverCommon + '/lib/winstonWrapper').winston;

winston.error('errorTest');
winston.warn('warnTest');
winston.info('infoTest');