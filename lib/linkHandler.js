var serverCommon = process.env.SERVER_COMMON;

var utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , async = require('async')
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
          linkHandler.checkAndPromoteLinks(links, mail, waterfallCallback);
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

exports.checkAndPromoteLinks = function(links, mail, callback) {
  async.forEach(links, function(link, forEachCallback) {
    linkHandler.checkAndPromoteLink(link, mail, forEachCallback);
  }, callback);
}

exports.checkAndPromoteLink = function(link, mail, callback) {
  linkHandler.isPromotable(link, mail, function(err, isPromotable) {
    if ( err ) {
      callback(err);
    } else if ( isPromotable ) {
      //TODO: diffbot and/or do whatever we want...
      
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
      winston.info('linkHandler: checkAndPromoteLink: link is not promotable: ' + link.url);
      callback();
    }
  });
}

exports.isPromotable = function(link, mail, callback) {
  //TODO: write this...
  callback(null, false);
}