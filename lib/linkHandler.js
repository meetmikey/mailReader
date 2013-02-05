var serverCommon = process.env.SERVER_COMMON;

var utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , async = require('async')
  , fs = require('fs')
  , libURL = require ('url')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , LinkModel = require(serverCommon + '/schema/link').LinkModel

var linkHandler = this;

exports.extractLinks = function(mail, mailId, userId, callback) {

  winston.info('extractLinks...');

  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! mailId ) { callback( winston.makeMissingParamError('mailId') ); return; }
  if ( ! userId ) { callback( winston.makeMissingParamError('userId') ); return; }
  
  var regEx = regEx = /((https?:\/\/)?[@\w-]{2,}(\.[@\w-]{2,})+\.?(:\d+)?(\/[A-Za-z0-9\-\._~:\/\?#=&+]*)?)/gi;

  var source = mail.html;
  if ( ! source ) {
    source = mail.text;
  }

  if ( ! source ) {
    winston.warn('linkHandler: extractLinks: no source in mail: ' + JSON.stringify(mail) );
    callback();
  } else {

    var matchedURLs = source.match(regEx);
    if ( ( ! matchedURLs ) || ( matchedURLs.length == 0 ) ) {
      callback();
    } else {
      async.waterfall([
        function(waterfallCallback) {
          linkHandler.dedupeAndValidateURLs(matchedURLs, waterfallCallback)
        },
        function(validURLs, waterfallCallback) {
          linkHandler.createAndSaveLinks(validURLs, mail, mailId, userId, waterfallCallback);
        },
        function(links, waterfallCallback) {
          linkHandler.checkAndPromoteLinks(links, mail, false, waterfallCallback);
        }],
        function(err) {
          callback(err);
        }
      );
    }
  }
}

exports.dedupeAndValidateURLs = function(urls, callback) {
  var validURLs = [];
  
  async.forEachSeries( urls, function(url, forEachSeriesCallback) {

    if ( linkHandler.isValidURL(url) && ( validURLs.indexOf(url) === -1 ) ) {
      validURLs.push(url);
    } else {
      winston.info('linkHandler: dedupeAndValidateURLs: url is either invalid or duplicate: ' + url);
    }
    forEachSeriesCallback();

  }, function(err) {
    callback(err, validURLs);
  });
}

exports.createAndSaveLinks = function(urls, mail, mailId, userId, callback) {
  var links = [];
  async.forEachSeries( urls, function(url, forEachSeriesCallback) {
    linkHandler.createAndSaveLink(url, mail, mailId, userId, function(err, link) {
      if ( ! err ) {
        links.push(link);
      }
      forEachSeriesCallback(err);
    });
  }, function(err) {
    callback(err, links);
  }); 
}

exports.createAndSaveLink = function(url, mail, mailId, userId, callback) {
  var link = new LinkModel({
      userId: userId
    , mailId: mailId
    , url: url
    , isPromoted: false
    , hasBeenDiffboted: false
    , sentDate: mailUtils.getSentDate(mail)
    , sender: mailUtils.getSender(mail)
    , recipients: mailUtils.getAllRecipients(mail)
  });

  link.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      callback(null, link);
    }
  });
}

exports.isValidURL = function(url) {
  if ( ( ! url ) || ( url.length == 0 ) ) {
    return false;
  }
  if ( url.indexOf('@') !== -1 ) { //Make sure it's not an email address...
    return false;
  }
  return true;
}

exports.checkAndPromoteLinks = function(links, mail, saveIfNotPromotable, callback) {
  async.forEachSeries(links, function(link, forEachCallback) {
    linkHandler.checkAndPromoteLink(link, mail, saveIfNotPromotable, forEachCallback);
  }, callback);
}

exports.checkAndPromoteLink = function(link, mail, saveIfNotPromotable, callback) {
  linkHandler.isPromotable(link, mail, function(err, isPromotable) {
    if ( err ) {
      callback(err);
    } else if ( isPromotable ) {
      //TODO: diffbot and/or do whatever we want...
      
      winston.info('linkHandler: checkAndPromoteLink: link is promotable: ' + link.url);

      //Now mark it promoted...
      link.isPromoted = true;
      link.save( function(err) {
        if ( err ) {
          callback( winston.makeMongoError(err) );
        } else {
          callback();
        }
      });
    } else {
      //winston.info('linkHandler: checkAndPromoteLink: link is NOT promotable: ' + link.url);
      if ( saveIfNotPromotable ) {
        link.isPromoted = false;
        link.save( function(err) {
          if ( err ) {
            callback( winston.makeMongoError(err) );
          } else {
            callback();
          }
        });
      } else {
        callback();
      }
    }
  });
}

exports.isPromotable = function(link, mail, callback) {
  if ( ( ! link ) || ( ! link.url ) ) {
    callback(null, false);
    return;
  }
  var url = link.url;

  if ( linkHandler.isImageURL(url) ) {
    callback(null, false);
  } else if ( ! linkHandler.isValidTopLevelDomain(url) ) {
    callback(null, false);
  } else {
    callback(null, true);
  }
}

exports.isImageURL = function(url) {
  if ( ! url ) {
    return false;
  }
  var imageSuffixes = ['bmp', 'gif', 'jpg', 'jpeg', 'png', 'raw', 'svg', 'tiff'];
  var dotSuffixIndex = url.lastIndexOf('.');
  if ( dotSuffixIndex !== - 1 ) {
    var suffix = url.substring(dotSuffixIndex + 1);
    if ( imageSuffixes.indexOf(suffix) !== -1 ) {
      return true;
    }
  }
  return false;
}


fs.readFile('./data/validTopLevelDomains.txt', 'utf8', function (err, data) {
  linkHandler.validTopLevelDomains = [];
  if ( ( ! err ) && ( data ) ) {
    linkHandler.validTopLevelDomains = data.split('\n');
  }
});

exports.isValidTopLevelDomain = function(url) {

  if ( ! url ) {
    return false;
  }
  url = url.trim();

  var protocols = ['http://','https://'];
  var hasProtocol = false;
  for ( var i=0; i<protocols.length; i++ ) {
    var protocol = protocols[i];
    if ( url.substring(0, protocol.length) == protocol ) {
      hasProtocol = true;
      break;
    }
  }
  if ( ! hasProtocol ) {
    url = 'http://' + url;
  }

  var parsed = libURL.parse(url);
  var hostname = parsed.hostname;
  var lastDot = hostname.lastIndexOf('.');

  if ( lastDot == -1 ) {
    return false;
  }

  var topLevelDomain = hostname.substring(lastDot + 1);

  if ( ! topLevelDomain ) {
    return false;
  }

  var topLevelDomainUpper = topLevelDomain.toUpperCase();

  if ( linkHandler.validTopLevelDomains.indexOf(topLevelDomainUpper) !== -1 ) {
    return true;
  }
  return false;
}