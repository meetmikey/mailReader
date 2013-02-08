var serverCommon = process.env.SERVER_COMMON;

var utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , urlUtils = require(serverCommon + '/lib/urlUtils')
  , async = require('async')
  , fs = require('fs')
  , request = require('request')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , diffbot = require('./diffbotWrapper').diffbot

var linkHandler = this;

exports.extractLinks = function(parsedMail, mailId, userId, callback) {

  winston.info('extractLinks...');

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mailId ) { callback( winston.makeMissingParamError('mailId') ); return; }
  if ( ! userId ) { callback( winston.makeMissingParamError('userId') ); return; }
  
  var regEx = regEx = /((https?:\/\/)?[@\w-]{2,}(\.[@\w-]{2,})+\.?(:\d+)?(\/[A-Za-z0-9\-\._~:\/\?#=&+]*)?)/gi;

  var source = parsedMail.html;
  if ( ! source ) {
    source = parsedMail.text;
  }

  if ( ! source ) {
    winston.warn('linkHandler: extractLinks: no source in parsedMail: ' + JSON.stringify(parsedMail) );
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
          linkHandler.createAndSaveLinks(validURLs, parsedMail, mailId, userId, waterfallCallback);
        },
        function(links, waterfallCallback) {
          linkHandler.checkAndPromoteLinks(links, parsedMail, false, waterfallCallback);
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

exports.createAndSaveLinks = function(urls, parsedMail, mailId, userId, callback) {
  var links = [];
  async.forEachSeries( urls, function(url, forEachSeriesCallback) {
    linkHandler.createAndSaveLink(url, parsedMail, mailId, userId, function(err, link) {
      if ( ! err ) {
        links.push(link);
      }
      forEachSeriesCallback(err);
    });
  }, function(err) {
    callback(err, links);
  }); 
}

exports.createAndSaveLink = function(url, parsedMail, mailId, userId, callback) {
  var link = new LinkModel({
      userId: userId
    , mailId: mailId
    , url: url
    , isPromoted: false
    , hasBeenDiffboted: false
    , sentDate: mailUtils.getSentDate(parsedMail)
    , sender: mailUtils.getSender(parsedMail)
    , recipients: mailUtils.getAllRecipients(parsedMail)
    , mailCleanSubject: mailUtils.getCleanSubject( parsedMail.subject )
    , mailBodyText: parsedMail.text
    , mailBodyHTML: parsedMail.html
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

exports.checkAndPromoteLinks = function(links, parsedMail, saveIfNotPromotable, callback) {
  async.forEachSeries(links, function(link, forEachCallback) {
    linkHandler.checkAndPromoteLink(link, parsedMail, saveIfNotPromotable, forEachCallback);
  }, callback);
}

exports.checkAndPromoteLink = function(link, parsedMail, saveIfNotPromotable, callback) {
  linkHandler.isPromotable(link, parsedMail, function(err, isPromotable) {
    if ( err ) {
      callback(err);
    } else if ( isPromotable ) {

      winston.info('linkHandler: checkAndPromoteLink: link is promotable: ' + link.url);
      linkHandler.markLinkPromoted(link, true, function(err) {
        if (err) {
          callback(err);
        } else {
          linkHandler.followLink(link, function(err) {
            callback(err);
          });
        }
      });
      
    } else {
      //winston.info('linkHandler: checkAndPromoteLink: link is NOT promotable: ' + link.url);
      if ( saveIfNotPromotable ) {
        linkHandler.markLinkPromoted(link, false, function(err) {
          callback(err);
        });
      } else {
        callback();
      }
    }
  });
}

exports.markLinkPromoted = function(link, isPromoted, callback) {
  link.isPromoted = isPromoted;
  link.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      callback();
    }
  });
}

exports.isPromotable = function(link, parsedMail, callback) {
  if ( ( ! link ) || ( ! link.url ) ) {
    callback(null, false);
    return;
  }
  var url = link.url;

  if ( urlUtils.isImageURL(url) ) {
    callback(null, false);
  } else if ( ! linkHandler.isValidTopLevelDomain(url) ) {
    callback(null, false);
  } else {
    callback(null, true);
  }
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
  
  url = urlUtils.addProtocolIfMissing( url );

  var parsedURL = urlUtils.parseURL(url);
  var hostname = parsedURL.hostname;
  var lastDotIndex = hostname.lastIndexOf('.');

  if ( lastDotIndex == -1 ) {
    return false;
  }

  var topLevelDomain = hostname.substring(lastDotIndex + 1);
  if ( ! topLevelDomain ) {
    return false;
  }

  var topLevelDomainUpper = topLevelDomain.toUpperCase();
  if ( linkHandler.validTopLevelDomains.indexOf(topLevelDomainUpper) !== -1 ) {
    return true;
  }
  return false;
}


exports.followLink = function(link, callback) {

  if ( ! link ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! link.url ) { callback( winston.makeMissingParamError('link url') ); return; }


  //TEMP: TURNED OFF!!
  callback();
  return;


  var url = link.url;

  if ( urlUtils.isPDF(url) ) {
    linkHandler.followPDFLink(link, callback);

  } else if ( urlUtils.isGoogleDoc(url) ) {
    linkHandler.followGoogleDocLink(link, callback);

  } else { // a normal url we send to diffbot
    linkHandler.followDiffbotLink(link, callback);
  }
}

exports.followDiffbotLink = function(link, callback) {

  var url = link.url;
  if ( urlUtils.isYoutubeURL(url) ) {
    url = urlUtils.getFixedYoutubeURL(url);
  }

  var diffbotData = {
      uri: url
    , summary: true
    , tags: true
    , stats: true
  }

  winston.info('Diffboting url: ' + url);
  diffbot.article( diffbotData,
    function(err, response) {

      if ( err || ( ! response ) || ( response.errorCode ) ) {
        winston.warn('linkHandler: followDiffbotLink: diffbot failed, following link directly...', {err: err, response: response});
        linkHandler.followLinkDirectly(link, callback);
      
      } else {
        linkHandler.processDiffbotResponse(response, link, callback);
      }
    }
  );
}

exports.processDiffbotResponse = function(diffbotResponse, link, callback) {
  var imageURL = null;
  if ( diffbotResponse.media && ( diffbotResponse.media.length > 0 ) ) {
    diffbotResponse.media.forEach(function (media) {
      if ( ( ! imageURL ) && ( media.primary == "true" ) && ( media.type == 'image' ) ) {
        imageURL = media.link;
      }
    });
  }

  var url = link.url;

  //youtube image hack
  if ( urlUtils.isYoutubeURL( link.url ) ) {
    imageURL = urlUtils.getYoutubeImage( url );
  }

  var text = diffbotResponse.text;

  var summary = '';
  if ( diffbotResponse.summary ) {
    summary = diffbotResponse.summary;
  }

  //delete irrelevant field
  delete diffbotResponse.xpath;

  link.hasBeenDiffboted = true;
  link.diffbotResponse = diffbotResponse;
  if ( imageURL ) {
    s3Utils.downloadAndSaveStaticImage(image, function (err, imageS3URL) {
      link.image = imageS3URL;
      linkHandler.saveLink(link, callback);
    });
  } else {
    linkHandler.saveLink(link, callback);
  }
}

exports.saveLink = function(link, callback) {
  link.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      callback();
    }
  });
}

exports.followPDFLink = function(link, callback) {
  winston.info('linkHandler: followPDFLink: url: ' + url);

  urlUtils.resolveURL( link.url, function(err, resolvedURL, isHTTPS ) {

    var title = urlUtils.lastToken( pdfURL );

    //TODO: Download and index the pdf...

    callback();
  });
}

exports.followGoogleDocLink = function(link, callback) {
  winston.info('linkHandler: followGoogleDocLink: url: ' + url);

  //TODO: download doc, index it...

  callback();
}

exports.followLinkDirectly = function(link, callback) {
  winston.info('linkHandler: followLinkDirectly: url: ' + url);

  var url = link.url;
  urlUtils.resolveURL( url, function(err, resolvedURL, isHTTPS, fullResponse ) {
    
    //TODO: index this response...

    callback();
  });
}