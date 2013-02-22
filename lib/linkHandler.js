var serverCommon = process.env.SERVER_COMMON;

var utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , urlUtils = require(serverCommon + '/lib/urlUtils')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , contactUtils = require(serverCommon + '/lib/contactUtils')
  , async = require('async')
  , fs = require('fs')
  , request = require('request')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , LinkInfoModel = require(serverCommon + '/schema/linkInfo').LinkInfoModel
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , UserModel = require(serverCommon + '/schema/user').UserModel
  , diffbot = require('./diffbotWrapper').diffbot
  , indexingHandler = require ('./indexingHandler')
  , mailReaderConstants = require('../constants')
  , mailReaderConf = require('../conf')
  , cheerio = require('cheerio')

var linkHandler = this;
var isLink = true;

fs.readFile('./data/validTopLevelDomains.txt', 'utf8', function (err, data) {
  linkHandler.validTopLevelDomains = [];
  if ( ( ! err ) && ( data ) ) {
    linkHandler.validTopLevelDomains = data.split('\n');
  }
});

exports.extractLinks = function(parsedMail, mail, callback) {

  //winston.doInfo('linkHandler: extractLinks...');

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
    winston.doWarn('linkHandler: findLinks: missing parsedMail');
    return [];
  }

  var regEx = regEx = /((https?:\/\/)?[@\w-]{2,}(\.[@\w-]{2,})+\.?(:\d+)?(\/[A-Za-z0-9\-\._~:;\/\?#=&+!\(\)]*)?)/gi;

  var source = mailUtils.getBodyHTML( parsedMail );
  if ( ! source ) {
    source = mailUtils.getBodyText( parsedMail );
  }

  if ( ! source ) {
    winston.doWarn('linkHandler: findLinks: no source in parsedMail: ', {parsedMail: parsedMail} );
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

  //winston.doInfo('linkHandler: dedupeAndValidateURLs...');

  var validURLs = [];
  var validComparableURLs = [];
  
  async.forEachSeries( urls, function(url, forEachSeriesCallback) {
    
    var comparableURL = urlUtils.getComparableURL( url );
    if ( linkHandler.isValidURL( url ) && ( validComparableURLs.indexOf( comparableURL ) === -1 ) ) {
      var urlWithProtocol = urlUtils.addProtocolIfMissing( url );
      validURLs.push( urlWithProtocol );
      validComparableURLs.push( comparableURL );
    } else {
      //winston.doInfo('linkHandler: dedupeAndValidateURLs: url is either invalid or duplicate: ' + url);
    }
    forEachSeriesCallback();

  }, function(err) {
    //winston.doInfo ('valid urls', {urls : validURLs});
    callback(err, validURLs);
  });
}

exports.handleValidURLs = function(urls, mail, callback) {

  //winston.doInfo('linkHandler: handleValidURLs...');

  if ( ( ! urls ) || ( ! ( urls.length > 0 ) ) ) {
    winston.doWarn('linkHandler: handleValidURLs: urls array is empty');
    callback();
    return;
  }
  
  //Get the contact data once here at the beginning, so we can process all the URLs in parallel
  contactUtils.getContactData( mail.userId, mail.sender.email, function(err, contactData) {
    if ( err ) {
      callback( err );

    } else if ( ! contactData ) {
      callback( winston.makeError('no contact data found', {mailId: mail._id, userId: mail.userId, senderEmail: mail.sender.email}) );

    } else {
      mail.senderContactData = contactData;
      async.forEach( urls, function(url, forEachCallback) {
        linkHandler.handleValidURL(url, mail, function(err, link) {
          forEachCallback(err);
        });
      }, function(err) {
        callback(err);
      });
    }
  });
}

exports.getLinkInfo = function( url, userId, callback ) {

  //winston.doInfo('linkHandler: getLinkInfo...');

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  var comparableURL = urlUtils.getComparableURL(url);
  var comparableURLHash = urlUtils.hashURL(comparableURL);

  var query = {
    comparableURLHash: comparableURLHash
  }
  var updateSet = { $set: {
      comparableURLHash: comparableURLHash
    , rawURL: url
    , comparableURL: comparableURL
  }};
  var options = {
      upsert:true
    , new: false
  }

  LinkInfoModel.findOneAndUpdate(query, updateSet, options, function(err, previousLinkInfo) {
    if ( err ) {
      callback( winston.makeMongoError( err ) );

    } else {
      //Lookup the thing we just saved.
      //This seems wasteful, but I'd really like to have the clean linkInfo.
      LinkInfoModel.findOne({comparableURLHash: comparableURLHash}, function(err, linkInfo) {
        if ( err ) {
          callback(err);

        } else if ( ! linkInfo ) {
          callback( winston.makeError('failed to find linkInfo we just upserted', {comparableURLHash: comparableURLHash, rawURL: url}) );

        } else {
          callback( null, linkInfo ); //let the link extraction process move along...

          if ( ! previousLinkInfo._id ) { //we just created this linkInfo
            //Kick off a followLink call...
            linkHandler.followLinkUploadToS3AndSave( linkInfo, userId, function( err ) {
              if ( err ) {
                //Handle this error here since the link extraction process has moved on...
                winston.handleError(err);

              } else if ( linkInfo.followType == 'fail' ) {
                winston.doWarn('linkHandler: getLinkInfo: link following failed, un-promoting links, not indexing', {url: url});
                //No need to index here.
                linkHandler.unpromoteLinks( linkInfo );

              } else {
                linkHandler.updateLinksWithLinkInfo( linkInfo );
              }
            });
          }
        }
      });
    }
  });
}

exports.unpromoteLinks = function( linkInfo ) {

  if ( !  linkInfo ) { winston.doMissingParamError('linkInfo'); return; }
  if ( !  linkInfo.comparableURLHash ) { winston.doMissingParamError('linkInfo.comparableURLHash'); return; }

  var query = {
    comparableURLHash: linkInfo.comparableURLHash
  };
  var updateSet = {$set: {
    isPromoted: false
  }};

  LinkModel.update( query, updateSet, {multi: true}, function(err) {
    if ( err ) {
      winston.doMongoError( err );
    }
  });
}

exports.updateLinksWithLinkInfo = function( linkInfo ) {
  
  winston.doInfo('linkHandler: updateLinksWithLinkInfo...');

  if ( !  linkInfo ) { winston.doMissingParamError('linkInfo'); return; }
  if ( !  linkInfo.comparableURLHash ) { winston.doMissingParamError('linkInfo.comparableURLHash'); return; }

  var query = {
    comparableURLHash: linkInfo.comparableURLHash
  };
  var updateSet = {$set: {
  }};
  var doUpdate = false;
  if ( linkInfo.image ) {
    updateSet['$set']['image'] = linkInfo.image;
    doUpdate = true;
  }
  if ( linkInfo.title ) {
    updateSet['$set']['title'] = linkInfo.title;
    doUpdate = true;
  }
  if ( linkInfo.summary ) {
    updateSet['$set']['summary'] = linkInfo.summary;
    doUpdate = true;
  }
  if ( linkInfo.resolvedURL ) {
    updateSet['$set']['resolvedURL'] = linkInfo.resolvedURL;
    doUpdate = true;
  }
  if ( ! doUpdate ) {
    return;
  }

  LinkModel.update( query, updateSet, {multi: true}, function(err) {
    if ( err ) {
      winston.doMongoError( err );
    }
  });
}

exports.updloadLinkInfoDataToS3 = function( linkInfo, s3Data, mimeType, callback ) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  if ( ! s3Data ) { callback( winston.makeMissingParamError('s3Data') ); return; }
  if ( ! mimeType ) { callback( winston.makeMissingParamError('mimeType') ); return; }

  var s3Path = s3Utils.getLinkInfoS3Path( linkInfo );
  var headers = {
    'Content-Type': mimeType
  }

  s3Utils.putBuffer( s3Data, s3Path, headers, true, function(err) {
    if ( err ) {
      callback( err );
    } else {
      callback();
    }
  });
}

exports.handleValidURL = function(url, mail, callback) {

  //winston.doInfo('linkHandler: handleValidURL...');

  linkHandler.isPromotable( url, mail, function(err, isPromotable) {
    if ( err ) {
      callback(err);

    } else if ( ! isPromotable ) {
      //Save non-promoted link
      //winston.doInfo('non-promotable link', {url: url});
      linkHandler.buildAndSaveLink( url, mail, false, callback);
      
    } else {
      linkHandler.checkAndHandleDuplicateOnThread( url, mail, function( err, isDuplicateOnThread ) {
        if ( err ) {
          callback( err );

        } else if ( isDuplicateOnThread ) {
          //Was handled by checkAndHandleDuplicateOnThread, so we're done.
          callback();

        } else {
          //winston.doInfo('handleValidURL... promotable link that is not duplicate', {url: url});

          //Normal case: first time we've seen this link on this thread for this user.

          linkHandler.buildAndSaveLink( url, mail, true, function( err, link ) {
            if ( err ) {
              callback( err );

            } else {
              linkHandler.getLinkInfo( url, mail.userId, function( err, linkInfo ) {
                if ( err ) {
                  callback(err);

                } else if ( ! linkInfo ) {
                  callback( winston.makeError('no linkInfo') );

                } else {
                  linkHandler.updateLinkFromLinkInfo( link, linkInfo, function(err) {
                    if ( err ) {
                      callback(err);

                    } else {
                      var resourceId = link.comparableURLHash
                      indexingHandler.indexResourceMetadata (link, mail, resourceId, isLink, function (err) {
                        callback();
                      })
                    }
                  });
                }
              });
            }
          });
        }
      });
    }
  });
}

exports.updateLinkFromLinkInfo = function( link, linkInfo, callback ) {

  if ( ! link ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  
  //winston.doInfo('linkHandler: updateLinkFromLinkInfo...');

  var updateSet = {$set: {
    linkInfoId: linkInfo._id
  }};
  if ( linkInfo.image ) {
    link.image = linkInfo.image;
    updateSet['$set']['image'] = link.image;
  }
  if ( linkInfo.title ) {
    link.title = linkInfo.title;
    updateSet['$set']['title'] = link.title;
  }
  if ( linkInfo.summary ) {
    link.image = linkInfo.summary;
    updateSet['$set']['summary'] = link.summary;
  }
  
  LinkModel.findOneAndUpdate( {_id: link._id}, updateSet, function(err) {
    if ( err ) {
      callback( winston.makeMongoError( err ) );

    } else {
      callback();
    }
  });
}

exports.isPromotable = function( url, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  if ( ( ! mail.senderContactData )
    || ( ( typeof mail.senderContactData.sent ) == 'undefined' )
    || ( ( typeof mail.senderContactData.corecipient ) == 'undefined' ) ) {
    //senderContactData should have been set already
    callback( winston.makeMissingParamError('mail.senderContactData') );
    return;
  }

  var isPromotable = linkHandler.isPromotableWithData( url, mail.senderContactData );
  callback( null, isPromotable );
}

exports.isPromotableWithData = function( url, contactData ) {

  if ( ! url ) { winston.doMissingParamError('url'); return false; }
  if ( ! contactData ) { winston.doMissingParamError('contactData'); return false; }

  if ( ( ! ( contactData.sent > 0 ) )
    && ( ! ( contactData.corecipient > 0 ) ) ) {
    //winston.doInfo('linkHandler: isPromotableWithData: url is not promotable because contact sent and corecipient are both zero');
    return false;
  }

  var urlFilterText = mailReaderConstants.URL_FILTER_TEXT;
  if ( utils.containsSubstringFromArray( url, urlFilterText ) ) {
    //winston.doWarn('linkHandler: isPromotable: url is not promotable because of filter text', {url: url});
    return false;
  }
  return true;
}

exports.checkAndHandleDuplicateOnThread = function( url, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! mail.userId ) { callback( winston.makeMissingParamError('mail.userId') ); return; }
  if ( ! mail.gmThreadId ) { callback( winston.makeMissingParamError('mail.gmThreadId') ); return; }

  //winston.doInfo('linkHandler: checkAndHandleDuplicateOnThread...');

  var duplicateSearchCriteria = {
      userId: mail.userId
    , gmThreadId: mail.gmThreadId
    , comparableURLHash: urlUtils.getComparableURLHash( url )
  }

  LinkModel.findOne( duplicateSearchCriteria, function(err, foundLink) {
    if ( err ) {
      callback( winston.makeMongoErr(err) );

    } else if ( ! foundLink ) {
      //No duplicate on this thread, move along...
      callback(null, false);

    } else if ( mail.sentDate.getTime() < foundLink.sentDate.getTime() ) {
      //winston.doInfo('linkHandler: checkAndHandleDuplicateOnThread: duplicate found on later message');
      linkHandler.updateLinkForMail( foundLink, url, mail, function(err) {
        if ( err ) {
          callback(err);
        } else {
          indexingHandler.updateResourceMetadata (foundLink, mail, foundLink.comparableURLHash, isLink, function (err) {
            callback(err, true);
          })
        }
      });

    } else {
      //This link already exists on an earlier mail in this thread,
      // so just ignore it and move on...
      //winston.doInfo('linkHandler: checkAndHandleDuplicateOnThread: duplicate found on earlier message');
      callback(null, true);
    }
  });
}

exports.updateLinkForMail = function( link, url, mail, callback ) {

  if ( ! link ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  winston.doInfo('linkHandler: updateLinkForMail...');

  var updateSet = { $set: {
      mailId: mail._id
    , url: url
    , comparableURLHash: urlUtils.getComparableURLHash( url )
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , mailBodyText: mail.bodyText
    , mailBodyHTML: mail.bodyHTML
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId ? mail.gmMsgId : ''
  }};

  LinkModel.findOneAndUpdate({_id : link._id}, updateSet, function(err, updatedLink) {
    if ( err ) {
      callback( winston.makeMongoError(err) );

    } else {
      callback();
    }
  });
}

exports.buildAndSaveLink = function( url, mail, isPromoted, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('linkHandler: buildAndSaveLink...');

  var link = linkHandler.buildLink( url, mail, isPromoted );
  if ( ! link ) {
    callback( winston.makeError('failed to build link') );

  } else {
    link.save( function(err) {
      if ( err ) {
        callback( winston.makeMongoError(err) );
      } else {
        callback( null, link );
      }
    });
  }
}

exports.buildLink = function( url, mail, isPromoted ) {

  if ( ! url ) { winston.doMissingParamError('url'); return null; }
  if ( ! mail ) { winston.doMissingParamError('mail'); return null; }

  var link = new LinkModel({
      userId: mail.userId
    , mailId: mail._id
    , url: url
    , comparableURLHash: urlUtils.getComparableURLHash( url )
    , isPromoted: isPromoted
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , mailBodyText: mail.bodyText
    , mailBodyHTML: mail.bodyHTML
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
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

exports.isValidTopLevelDomain = function( url ) {

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

//This function's callback expects to have the linkInfo.followType set appropriately.
//Upon callback, if the followType != 'fail' and the s3Data != '', it will be indexed.
//Errors are expected to be handled here, not called back.
exports.followLinkUploadToS3AndSave = function( linkInfo, userId, callback ) {

  //winston.doInfo('linkHandler: followLinkUploadToS3AndSave...');

  linkInfo.lastFollowDate = new Date();
  linkInfo.followType = 'fail'; //Start with fail, update to success.
  linkHandler.followLink( linkInfo, userId, function( err, s3Data, mimeType ) {
    if ( err ) {
      winston.handleError( err );
      callback();

    } else {
      if ( ! s3Data ) {
        var warnData = {followType: linkInfo.followType, url: linkHandler.getRealURL( linkInfo )};
        winston.doWarn('linkHandler: followLinkUploadToS3AndSave: empty s3Data', warnData);
        linkInfo.followType = 'fail';
        callback();

      } else if ( linkInfo.followType == 'fail' ) {
        var warnData = {url: linkHandler.getRealURL( linkInfo )};
        winston.doWarn('linkHandler: followLinkUploadToS3AndSave: following failed', warnData);
        callback();

      } else {
        linkHandler.updloadLinkInfoDataToS3( linkInfo, s3Data, mimeType, function( err ) {
          if ( err ) {
            winston.handleError( err );
          }

          indexingHandler.indexResource (linkInfo, s3Data, linkInfo.comparableURLHash, isLink, function (err) {
            if ( err ) {
              winston.handleError( err );
            }
            callback();
          });
        });
      }

      //Always save the link info...
      linkHandler.updateLinkInfoAfterFollowingLink( linkInfo, function(err) {
        if ( err ) {
          winston.handleError( err );
        }
      });
    }
  });
}

exports.followLink = function( linkInfo, userId, callback ) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  //winston.doInfo('linkHandler: followLink...', {url: url});

  if ( urlUtils.isPDF(url) ) {
    linkHandler.followPDFLink(linkInfo, callback);

  } else if ( urlUtils.isGoogleDoc(url) ) {
    linkHandler.followGoogleDocLink( linkInfo, userId, callback );

  } else { // a normal url we send to diffbot
    linkHandler.followDiffbotLink(linkInfo, callback );
  }
}

exports.followDiffbotLink = function( linkInfo, callback ) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  //winston.doInfo('linkHandler: followDiffbotLink...', {url: url});

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
    diffbot.article( diffbotData, function(err, response) {

      if ( err || ( ! response ) || ( response.errorCode ) ) {
        winston.doWarn('linkHandler: followDiffbotLink: diffbot failed', {err: err, response: response});
        linkHandler.followLinkDirectly( linkInfo, callback );
      
      } else {
        linkHandler.processDiffbotResponse( response, linkInfo, callback );
      }
    });
  } catch ( diffbotError ) {
    winston.doWarn('linkHandler: followDiffbotLink: diffbot threw an exception', {diffbotError: diffbotError});
    linkHandler.followLinkDirectly( linkInfo, callback );
  }
}

exports.processDiffbotResponse = function(diffbotResponse, linkInfo, callback) {

  //winston.doInfo('linkHandler: processDiffbotResponse...');

  if ( ! diffbotResponse ) { callback( winston.makeMissingParamError('diffbotResponse') ); return; }
  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }

  var imageURL = linkHandler.getImageURLFromDiffbotResponse( diffbotResponse );

  //youtube image hack
  var url = linkHandler.getRealURL( linkInfo );
  if ( urlUtils.isYoutubeURL( url ) ) {
    imageURL = urlUtils.getYoutubeImage( url );
  }

  //delete irrelevant field
  delete diffbotResponse.xpath;

  if ( diffbotResponse.resolved_url ) {
    linkInfo.resolvedURL = diffbotResponse.resolved_url;
  }
  if ( diffbotResponse.title ) {
    linkInfo.title = diffbotResponse.title;
  }

  if ( diffbotResponse.summary ) {
    linkInfo.summary = diffbotResponse.summary;
  } else if ( diffbotResponse.text ) {
    linkInfo.summary = diffbotResponse.text.substring(0, mailReaderConstants.LINK_SUMMARY_CUTOFF);
  }

  var mimeType = 'text/html';
  var packagedDiffbotResponse = indexingHandler.packageDiffbotResponseInHTML( diffbotResponse );
  if ( imageURL ) {
    s3Utils.downloadAndSaveStaticImage(imageURL, function (err, imageS3URL) {
      if ( err ) {
        winston.doWarn('linkHandler: processDiffbotResponse: error downloading static image', {err: err});
      }
      if ( imageS3URL ) {
        linkInfo.image = imageS3URL;
      }
      linkInfo.followType = 'diffbot';
      callback( null, packagedDiffbotResponse, mimeType );
    });
  } else {
    linkInfo.followType = 'diffbot';
    callback( null, packagedDiffbotResponse, mimeType );
  }
}

exports.getImageURLFromDiffbotResponse = function( diffbotResponse ) {
  var imageURL = null;
  if ( diffbotResponse.media && ( diffbotResponse.media.length > 0 ) ) {
    diffbotResponse.media.forEach(function (media) {
      if ( ( ! imageURL ) && ( media.primary == "true" ) && ( media.type == 'image' ) ) {
        imageURL = media.link;
      }
    });
  }
  return imageURL;
}

exports.updateLinkInfoAfterFollowingLink = function(linkInfo, callback) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  if ( ! linkInfo._id ) { callback( winston.makeMissingParamError('linkInfo._id') ); return; }
  if ( ! linkInfo.followType ) { callback( winston.makeMissingParamError('linkInfo.followType') ); return; }

  //winston.doInfo('linkHandler: updateLinkInfoAfterFollowingLink...');

  var updateSet = {$set: {
      lastFollowDate: linkInfo.lastFollowDate
    , followType: linkInfo.followType
  }};
  if ( linkInfo.resolvedURL ) {
    updateSet['$set']['resolvedURL'] = linkInfo.resolvedURL;
  }
  if ( linkInfo.image ) {
    updateSet['$set']['image'] = linkInfo.image;
  }
  if ( linkInfo.title ) {
    updateSet['$set']['title'] = linkInfo.title;
  }
  if ( linkInfo.summary ) {
    updateSet['$set']['summary'] = linkInfo.summary;
  }

  LinkInfoModel.update({_id: linkInfo._id}, updateSet, function(err) {
    if ( err ) {
      callback( winston.makeMongoError( err ) );
    } else {
      callback();
    }
  });
}

exports.followPDFLink = function( linkInfo, callback ) {

 if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  //winston.doInfo('linkHandler: followPDFLink...', {url: url});

  request( url, {timeout: mailReaderConstants.PDF_DOWNLOAD_TIMEOUT, encoding : null},
    function (error, response, body) {

      if ( error || ( ! response ) || ( ! response.body ) || ( response.statusCode !== 200 ) ) {
        winston.doWarn('linkHandler: followPDFLink: error downloading pdf', {url: url});
        callback();
        
      } else {
        var pdfData = response.body;
        var mimeType = 'application/pdf';
        linkInfo.followType = 'pdf';
        callback( null, pdfData, mimeType );
      }
    }
  );
}

exports.followGoogleDocLink = function( linkInfo, userId, callback ) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  if ( ! userId ) { callback( winston.makeMissingParamError('userId') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  //winston.doInfo('linkHandler: followGoogleDocLink...', {url: url});

  var googleDocId = urlUtils.extractGoogleDocId( url );
  if ( ! googleDocId ) {
    winston.doWarn('linkHandler: followGoogleDocLink: no googleDocId', {url: url});
    callback();
    return;
  }

  UserModel.findById( userId, function(err, foundUser) {
    if ( err ) {
      callback( winston.makeMongoError( err ) );

    } else if ( ! foundUser ) {
      callback( winston.makeError('failed to find user', {userId: userId, linkInfoId: linkInfo._id}) );

    } else if ( ! foundUser.accessToken ) {
      callback( winston.makeError('user has no access token', {userId: userId, linkInfoId: linkInfo._id}) );

    } else {
      var accessToken = foundUser.accessToken;
      var docMetadataURL = mailReaderConf.googleDriveAPIFileGetPrefix + googleDocId + '?access_token=' + accessToken;

      request( docMetadataURL, function(err, response, docMetadata) {
        if ( err ) {
          var warnData = {err: err, docMetadataURL: docMetadataURL, linkInfoId: linkInfo._id};
          winston.doWarn('linkHandler: followGoogleDocLink: failed getting metadata', warnData);
          callback();

        } else if ( ! docMetadata ) {
          var warnData = {docMetadataURL: docMetadataURL, linkInfoId: linkInfo._id};
          winston.doWarn('linkHandler: followGoogleDocLink: no docMetadata', warnData);
          callback();

        } else {
          linkHandler.getGoogleDocTitleSummaryAndData( docMetadata, accessToken, function( err, title, summary, docData, mimeType ) {
            if ( err ) {
              winston.handleError( err );
              callback();

            } else {
              linkInfo.title = title;
              linkInfo.summary = summary;

              if ( ! docData ) {
                var warnData = {docMetadata: docMetadata, linkInfoId: linkInfo._id};
                winston.doWarn('linkHandler: followGoogleDocLink: no docData from googleDoc', warnData);
                callback();

              } else {
                linkInfo.followType = 'googleDoc';
                callback( null, docData, mimeType );
              }
            }
          });
        }
      });
    }
  });
}

//callback expected arguments: function( err, title, summary, docData, mimeType )
exports.getGoogleDocTitleSummaryAndData = function( docMetadataRaw, accessToken, callback ) {

  if ( ! docMetadataRaw ) { callback( winston.makeMissingParamError('docMetadataRaw') ); return; }
  if ( ! accessToken ) { callback( winston.makeMissingParamError('accessToken') ); return; }

  var title = '';
  var summary = '';
  var mimeType = '';
  try {
    var docMetadata = JSON.parse( docMetadataRaw );
  } catch ( exception ) {
    callback( winston.makeError('failure parsing google doc metadata', {exception: exception, docMetadataRaw: docMetadataRaw}) );
    return;
  }

  //TODO: get doc thumbnail
  //See https://developers.google.com/drive/v2/reference/files#resource and look for thumbnailLink

  title = docMetadata['title'];
  exportLinks = docMetadata['exportLinks'];
  var exportLink = '';
  if ( exportLinks ) {
    if ( exportLinks['text/html'] ) {
      mimeType = 'text/html';
      exportLink = exportLinks['text/html'];

    } else if ( exportLinks['text/plain'] ) {
      mimeType = 'text/plain';
      exportLink = exportLinks['text/plain'];

    } else if ( exportLinks['application/pdf'] ) {
      mimeType = 'application/pdf';
      exportLink = exportLinks['application/pdf'];
    }
  }

  if ( ! exportLink ) {
    winston.doWarn('linkHandler: getGoogleDocTitleSummaryAndData: no valid export link', {docMetadata: docMetadata})
    callback( null, title, summary, null, mimeType );

  } else {
    if ( exportLink.indexOf('?') === -1 ) {
      exportLink += '?';
    } else {
      exportLink += '&';
    }
    exportLink += 'access_token=' + accessToken;

    request( exportLink, function(err, response, docData ) {
      if ( err ) {
        callback( winston.makeError('export request error', {err: err, exportLink: exportLink}) );

      } else if ( ! docData ) {
        winston.doWarn('linkHandler: getGoogleDocTitleSummaryAndData: no docData', {exportURL: exportURL, linkInfoId: linkInfo._id});
        callback( null, title, summary, null, mimeType );

      } else {
        if ( mimeType == 'text/html' ) {
          summary = linkHandler.extractSummaryFromHTML( docData );
        } else if ( mimeType == 'text/plain' ) {
          summary = docData.substring(0, mailReaderConstants.LINK_SUMMARY_CUTOFF);
        }
        callback( null, title, summary, docData, mimeType );
      }
    });
  }
}

exports.followLinkDirectly = function(linkInfo, callback) {

 if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  //winston.doInfo('linkHandler: followLinkDirectly...', {url: url});

  urlUtils.resolveURL( url, function( err, resolvedURL, isHTTPS, response ) {
    if ( err || ( ! response ) || ( ! response.body ) || ( response.statusCode !== 200 ) ) {
      var warnData = {err: err, url: url};
      if ( response ) {
        warnData.statusCode = response.statusCode;
      }
      winston.doWarn( 'linkHandler: followLinkDirectly: bad response from resolveURL', warnData );
      callback();

    } else {
      var html = response.body;
      var title = linkHandler.extractTitleFromHTML( html );
      var summary = linkHandler.extractSummaryFromHTML( html );

      linkInfo.title = title;
      linkInfo.summary = summary;
      linkInfo.resolvedURL = resolvedURL;

      var mimeType = 'text/html';
      linkInfo.followType = 'direct';
      callback( null, html, mimeType );
    }
  });
}

exports.getRealURL = function(linkInfo) {

  if ( ! linkInfo ) {
    winston.doWarn('linkHandler: getRealURL: no linkInfo!');
    return '';
  }

  if ( linkInfo.resolvedURL ) {
    return linkInfo.resolvedURL;
  }
  return linkInfo.rawURL;
}

exports.extractFieldFromHTML = function( html, field ) {
  if ( ! html ) {
    return '';
  }
  try {
    $ = cheerio.load( html );
  } catch ( exception ) {
    winston.doWarn('linkHandler: exception loading html with cheerio');
    return '';
  }

  return $(field).text(null, ' ');
}

exports.extractTitleFromHTML = function( html ) {
  return linkHandler.extractFieldFromHTML( html, 'title' );
}

exports.extractSummaryFromHTML = function( html ) {
  if ( ! html ) {
    return '';
  }

  var summary = linkHandler.extractDescriptionFromHTML( html );
  if ( ! summary ) {
    summary = linkHandler.extractFieldFromHTML( html, 'body' );
  }
  if ( summary ) {
    summary = summary.substring(0, mailReaderConstants.LINK_SUMMARY_CUTOFF);
    summary = summary.trim();
  }
  return summary;
}

exports.extractDescriptionFromHTML = function( html ) {
  if ( ! html ) {
    return '';
  }

  $ = cheerio.load( html );
  var description = $('meta').filter(function(i, el) {
    // this === el
    return $(this).attr('name') === 'description';
  }).attr('content');

  if ( description ) {
    description = description.trim();
  }
  return description;
}