var serverCommon = process.env.SERVER_COMMON;

var utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , urlUtils = require(serverCommon + '/lib/urlUtils')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , async = require('async')
  , fs = require('fs')
  , request = require('request')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , LinkInfoModel = require(serverCommon + '/schema/linkInfo').LinkInfoModel
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , diffbot = require('./diffbotWrapper').diffbot

var linkHandler = this;

var PDF_DOWNLOAD_TIMEOUT = 20000;

fs.readFile('./data/validTopLevelDomains.txt', 'utf8', function (err, data) {
  linkHandler.validTopLevelDomains = [];
  if ( ( ! err ) && ( data ) ) {
    linkHandler.validTopLevelDomains = data.split('\n');
  }
});

exports.extractLinks = function(parsedMail, mail, callback) {

  //winston.info('linkHandler: extractLinks...');

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  if ( linkHandler.shouldIgnoreEmail(mail) ) {
    linkHandler.setMailLinkExtractorState(mail, 'ignored', callback);

  } else {

    var matchedURLs = linkHandler.findURLs( parsedMail );
    if ( ( ! matchedURLs ) || ( matchedURLs.length == 0 ) ) {
      linkHandler.setMailLinkExtractorState(mail, 'noLinks', callback);

    } else {
      linkHandler.setMailLinkExtractorState(mail, 'started', function(err) {
        if ( err ) {
          callback(err);
        } else {

          async.waterfall([
            function(waterfallCallback) {
              linkHandler.dedupeAndValidateURLs(matchedURLs, waterfallCallback);
            },
            function(validURLs, waterfallCallback) {
              linkHandler.handleValidURLs(validURLs, mail, waterfallCallback);
            }],
            function(err) {
              if ( err ) {
                callback(err);
              } else {
                linkHandler.setMailLinkExtractorState(mail, 'done', callback);
              }
            }
          );
        }
      });
    }
  }
}

exports.findURLs = function( parsedMail ) {

  if ( ! parsedMail ) {
    winston.warn('linkHandler: findLinks: missing parsedMail');
    return [];
  }

  var regEx = regEx = /((https?:\/\/)?[@\w-]{2,}(\.[@\w-]{2,})+\.?(:\d+)?(\/[A-Za-z0-9\-\._~:\/\?#=&+!]*)?)/gi;

  var source = mailUtils.getBodyHTML( parsedMail );
  if ( ! source ) {
    source = mailUtils.getBodyText( parsedMail );
  }

  if ( ! source ) {
    winston.warn('linkHandler: findLinks: no source in parsedMail: ', {parsedMail: parsedMail} );
    return [];

  } else {
    var urls = source.match(regEx);
    return urls;
  }
}

exports.setMailLinkExtractorState = function(mail, state, callback) {
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return ; }

  var updateSet = { $set: {
    linkExtractorState: state
  }};

  MailModel.findOneAndUpdate({_id: mail._id}, updateSet, function(err, updatedMail) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      callback();
    }
  });
}

exports.shouldIgnoreEmail = function(mail) {

  if ( ! mail ) {
    winston.doMissingParamError('mail');
    return true;
  }

  if ( mail.hasMarketingFrom || mail.hasMarketingText ) {
    return true;
  }
  return false;
}

exports.dedupeAndValidateURLs = function(urls, callback) {

  //winston.info('linkHandler: dedupeAndValidateURLs...');

  var validURLs = [];
  var validComparableURLs = [];
  
  async.forEachSeries( urls, function(url, forEachSeriesCallback) {
    
    var comparableURL = urlUtils.getComparableURL( url );
    if ( linkHandler.isValidURL( url ) && ( validComparableURLs.indexOf( comparableURL ) === -1 ) ) {
      var urlWithProtocol = urlUtils.addProtocolIfMissing( url );
      validURLs.push( urlWithProtocol );
      validComparableURLs.push( comparableURL );
    } else {
      //winston.info('linkHandler: dedupeAndValidateURLs: url is either invalid or duplicate: ' + url);
    }
    forEachSeriesCallback();

  }, function(err) {
    callback(err, validURLs);
  });
}

exports.handleValidURLs = function(urls, mail, callback) {

  //winston.info('linkHandler: handleValidURLs...');

  async.forEach( urls, function(url, forEachCallback) {
    linkHandler.handleValidURL(url, mail, function(err, link) {
      forEachCallback(err);
    });
  }, function(err) {
    callback(err);
  });
}

exports.getLinkInfo = function(url, callback) {

  //winston.info('linkHandler: getLinkInfo...');

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  var comparableURL = urlUtils.getComparableURL(url);
  var urlHash = urlUtils.hashURL(comparableURL);

  LinkInfoModel.findOne({urlHash: urlHash}, function(err, foundLinkInfo) {
    if ( err ) {
      callback( winston.makeMongoError( err ) );

    } else if ( foundLinkInfo ) {
      callback( null, foundLinkInfo );

    } else {

      var newLinkInfo = new LinkInfoModel({
          urlHash: urlHash
        , rawURL: url
        , comparableURL: comparableURL
      });

      newLinkInfo.save( function(err) {
        if ( err ) {
          callback( winston.makeMongoError( err ) );

        } else {
          callback( null, newLinkInfo );

          //Kick off a followLink call, but the link extraction process has already moved on...
          linkHandler.followLink(newLinkInfo, function(err) {
            if ( err ) {
              //Handle this error here since it won't stop the link extraction process...
              winston.handleError(err);
            }
          });
        }
      });
    }
  });
}

exports.handleValidURL = function(url, mail, callback) {

  //winston.info('linkHandler: handleValidURL...');

  linkHandler.getLinkInfo(url, function(err, linkInfo) {
    if ( err ) {
      callback(err);

    } else if ( ! linkInfo ) {
      callback( winston.makeError('no linkInfo') );

    } else {
      linkHandler.checkAndHandleDuplicateOnThread( url, linkInfo, mail,
        function( err, isDuplicateOnThread ) {
          if ( err ) {
            callback( err );

          } else if ( isDuplicateOnThread ) {
            //Was handled by checkAndHandleDuplicateOnThread, so we're done.
            callback();

          } else { //Normal case: first time we've seen this link on this thread for this user.
            linkHandler.buildAndSaveLink( url, linkInfo, mail, callback );
          }
        }
      );
    }
  });
}

exports.checkAndHandleDuplicateOnThread = function( url, linkInfo, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! mail.userId ) { callback( winston.makeMissingParamError('mail.userId') ); return; }
  if ( ! mail.gmThreadId ) { callback( winston.makeMissingParamError('mail.gmThreadId') ); return; }

  //winston.info('linkHandler: checkAndHandleDuplicateOnThread...');

  var duplicateSearchCriteria = {
      userId: mail.userId
    , linkInfoId: linkInfo._id
    , gmThreadId: mail.gmThreadId
  }

  LinkModel.findOne( duplicateSearchCriteria, function(err, foundLink) {
    if ( err ) {
      callback( winston.makeMongoErr(err) );

    } else if ( ! foundLink ) {
      //No duplicate on this thread, move along...
      callback(null, false);

    } else if ( mail.sentDate.getTime() < foundLink.sentDate.getTime() ) {
      //winston.info('linkHandler: checkAndHandleDuplicateOnThread: duplicate found on later message');
      linkHandler.updateLinkForMail( foundLink, url, mail, function(err) {
        if ( err ) {
          callback(err);
        } else {
          callback(null, true);
        }
      });

    } else {
      //This link already exists on an earlier mail in this thread,
      // so just ignore it and move on...
      //winston.info('linkHandaler: checkAndHandleDuplicateOnThread: duplicate found on earlier message');
      callback(null, true);
    }
  });
}

exports.updateLinkForMail = function( link, url, mail, callback ) {

  if ( ! link ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.info('linkHandler: updateLinkForMail...');

  var updateSet = { $set: {
      mailId: mail._id
    , url: url
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , mailBodyText: mail.bodyText
    , mailBodyHTML: mail.bodyHTML
    , gmThreadId: mail.gmThreadId
  }};

  LinkModel.findOneAndUpdate({_id : link._id}, updateSet, function(err, updatedLink) {
    if ( err ) {
      callback( winston.makeMongoError(err) );

    } else {
      //TODO: update the index...
      callback();
    }
  });
}

exports.buildAndSaveLink = function( url, linkInfo, mail, callback) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  var link = linkHandler.buildLink( url, linkInfo, mail );
  if ( ! link ) {
    callback( winston.makeError('failed to build link') );
  } else {
    link.save( function(err) {
      if ( err ) {
        callback( winston.makeMongoError(err) );
      } else {
        callback();
      }
    });
  }
}

exports.buildLink = function( url, linkInfo, mail ) {

  if ( ! url ) { winston.doMissingParamError('url'); return null; }
  if ( ! linkInfo ) { winston.doMissingParamError('linkInfo'); return null; }
  if ( ! mail ) { winston.doMissingParamError('mail'); return null; }

  var link = new LinkModel({
      userId: mail.userId
    , mailId: mail._id
    , linkInfoId: linkInfo._id
    , url: url
    , isPromoted: true
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.cleanSubject
    , mailCleanSubject: mail.cleanSubject
    , mailBodyText: mail.bodyText
    , mailBodyHTML: mail.bodyHTML
    , gmThreadId: mail.gmThreadId
  });

  return link;
}

exports.isValidURL = function(url) {
  if ( ( ! url ) || ( url.length == 0 ) ) {
    return false;
  }
  if ( url.indexOf('@') !== -1 ) { //Make sure it's not an email address...
    return false;
  }
  if ( urlUtils.isImageURL(url) ) {
    return false;
  }
  if ( ! linkHandler.isValidTopLevelDomain(url) ) {
    return false;
  }
  return true;
}

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

exports.followLink = function(linkInfo, callback) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  //winston.info('linkHandler: followLink...', {url: url});

  if ( urlUtils.isPDF(url) ) {
    linkHandler.followPDFLink(linkInfo, callback);

  } else if ( urlUtils.isGoogleDoc(url) ) {
    linkHandler.followGoogleDocLink(linkInfo, callback);

  } else { // a normal url we send to diffbot
    linkHandler.followDiffbotLink(linkInfo, callback);
  }
}

exports.followDiffbotLink = function(linkInfo, callback) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  winston.info('linkHandler: followDiffbotLink...', {url: url});

  if ( urlUtils.isYoutubeURL(url) ) {
    url = urlUtils.getFixedYoutubeURL(url);
  }

  var diffbotData = {
      uri: url
    , summary: true
    , tags: true
    , stats: true
  }

  try {
    diffbot.article( diffbotData,
      function(err, response) {

        if ( err || ( ! response ) || ( response.errorCode ) ) {
          winston.warn('linkHandler: followDiffbotLink: diffbot failed', {err: err, response: response});
          linkInfo.lastDiffbotDate = new Date();
          linkHandler.saveLinkInfo(linkInfo, function(err) {
            if ( err ) { winston.handleError(err); } //Boo.  Don't stop, just handle it.
          });

          linkHandler.followLinkDirectly( linkInfo, callback );
        
        } else {
          linkHandler.processDiffbotResponse(response, linkInfo, callback);
        }
      }
    );
  } catch ( diffbotError ) {
    winston.warn('linkHandler: followDiffbotLink: diffbot threw an exception', {diffbotError: diffbotError});
    linkInfo.lastDiffbotDate = new Date();
    linkHandler.saveLinkInfo(linkInfo, function(err) {
      if ( err ) { winston.handleError(err); } //Boo.  Don't stop, just handle it.
    });
    linkHandler.followLinkDirectly( linkInfo, callback );
  }
}

exports.processDiffbotResponse = function(diffbotResponse, linkInfo, callback) {

  //winston.info('linkHandler: processDiffbotResponse...');

  if ( ! diffbotResponse ) { callback( winston.makeMissingParamError('diffbotResponse') ); return; }
  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }

  var imageURL = null;
  if ( diffbotResponse.media && ( diffbotResponse.media.length > 0 ) ) {
    diffbotResponse.media.forEach(function (media) {
      if ( ( ! imageURL ) && ( media.primary == "true" ) && ( media.type == 'image' ) ) {
        imageURL = media.link;
      }
    });
  }

  //youtube image hack
  var url = linkHandler.getRealURL( linkInfo );
  if ( urlUtils.isYoutubeURL( url ) ) {
    imageURL = urlUtils.getYoutubeImage( url );
  }

  var text = diffbotResponse.text;

  var summary = '';
  if ( diffbotResponse.summary ) {
    summary = diffbotResponse.summary;
  }

  //delete irrelevant field
  delete diffbotResponse.xpath;

  if ( diffbotResponse.resolved_url ) {
    linkInfo.resolvedURL = diffbotResponse.resolved_url;
  }

  linkInfo.lastDiffbotDate = new Date();
  linkInfo.diffbotResponse = diffbotResponse;
  if ( imageURL ) {
    s3Utils.downloadAndSaveStaticImage(imageURL, function (err, imageS3URL) {
      if ( err ) {
        winston.warn('linkHandler: processDiffbotResponse: error downloading static image', {err: err});
      }
      if ( imageS3URL ) {
        linkInfo.image = imageS3URL;
      }
      linkHandler.saveLinkInfo(linkInfo, callback);
    });
  } else {
    linkHandler.saveLinkInfo(linkInfo, callback);
  }
}

exports.saveLinkInfo = function(linkInfo, callback) {
  linkInfo.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      callback();
    }
  });
}

exports.followPDFLink = function(linkInfo, callback) {

 if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  winston.info('linkHandler: followPDFLink...', {url: url});

  request( url, {timeout: PDF_DOWNLOAD_TIMEOUT, encoding : null},
    function (error, response, body) {

      if ( error || ( ! response ) || ( response.statusCode !== 200 ) || ( ! response.body ) ) {
        callback( winston.makeError('error downloading pdf', {linkInfo: linkInfo}) );
        
      } else {
        var data = response.body;
        //TODO: index the pdf
        //TODO: store it in s3?

        callback();
      }
    }
  );

}

exports.followGoogleDocLink = function(linkInfo, callback) {

   if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  winston.info('linkHandler: followGoogleDocLink...', {url: url});

  //TODO: download doc, index it...

  callback();
}

exports.followLinkDirectly = function(linkInfo, callback) {

 if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  winston.info('linkHandler: followLinkDirectly...', {url: url});

  urlUtils.resolveURL( url, function( err, resolvedURL, isHTTPS, response ) {
    if ( err ) {
      //No biggie, probably just a bum link...
      winston.warn('linkHandler: followLinkDirectly: error from resolveURL', {log: err.log, url: url});

    } else {
      linkInfo.resolvedURL = resolvedURL;
      linkInfo.save( function(err) {
        if ( err ) {
          winston.doMongoError(err);
          //No need to callback here.  Not important enough to stop things.
        }
      });
    
      //TODO: handle response, index it...
    }
  });

  callback();
}


exports.getRealURL = function(linkInfo) {

  if ( ! linkInfo ) {
    winston.warn('linkHandler: getRealURL: no linkInfo!');
    return '';
  }

  if ( linkInfo.resolvedURL ) {
    return linkInfo.resolvedURL;
  }
  return linkInfo.rawURL;
}