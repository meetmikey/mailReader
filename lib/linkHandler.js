var serverCommon = process.env.SERVER_COMMON;

var utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , urlUtils = require(serverCommon + '/lib/urlUtils')
  , googleUtils = require(serverCommon + '/lib/googleUtils')
  , mongoUtils = require(serverCommon + '/lib/mongoUtils')
  , cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , contactUtils = require(serverCommon + '/lib/contactUtils')
  , async = require('async')
  , fs = require('fs')
  , request = require('request')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , LinkInfoModel = require(serverCommon + '/schema/linkInfo').LinkInfoModel
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , UserModel = require(serverCommon + '/schema/user').UserModel
  , sqsConnect = require (serverCommon + '/lib/sqsConnect')
  , diffbot = require('./diffbotWrapper').diffbot
  , indexingHandler = require (serverCommon + '/lib/indexingHandler')
  , mailReaderConstants = require('../constants')
  , mailReaderConf = require('../conf');

var linkHandler = this;

linkHandler.validTopLevelDomains = [];
fs.readFile('./data/validTopLevelDomains.txt', 'utf8', function (err, data) {
  linkHandler.validTopLevelDomains = [];
  if ( ( ! err ) && ( data ) ) {
    linkHandler.validTopLevelDomains = data.split('\n');
  }
});

exports.extractLinks = function(parsedMail, mail, callback) {

  //winston.doInfo('linkHandler: extractLinks...', {mailId: mail._id});

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  if ( linkHandler.shouldIgnoreEmail(mail) ) {
    linkHandler.setMailLinkExtractorState(mail, 'ignored', callback);

  } else {

    var matchedURLs = linkHandler.findURLs( parsedMail, mail._id );
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

exports.findURLs = function( parsedMail, mailId ) {

  if ( ! parsedMail ) {
    winston.doWarn('linkHandler: findLinks: missing parsedMail');
    return [];
  }

  var regEx = regEx = /((https?:\/\/)?[@\w-]{2,}(\.[@\w-]{2,})+\.?(:\d+)?(\/[A-Za-z0-9\-\._~:;%\/\?#=&+!\(\)]*)?)/gi;

  var source = mailUtils.getBodyHTML( parsedMail );
  if ( ! source ) {
    source = mailUtils.getBodyText( parsedMail );
  }

  if ( ! source ) {
    winston.doWarn('linkHandler: findLinks: no source in parsedMail: ', {mailId: mailId} );
    return [];

  } else {
    var urls = source.match(regEx);
    return urls;
  }
}

exports.setMailLinkExtractorState = function(mail, state, callback) {

  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return ; }

  var filter = {
      _id: mail._id
    , shardKey: mongoUtils.getShardKeyHash( mail.userId )
  };

  var updateSet = { $set: {
    linkExtractorState: state
  }};

  MailModel.findOneAndUpdate( filter, updateSet, function(err, updatedMail) {
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

  return mail.hasMarketingFrom || mail.hasMarketingText || linkHandler.mailHasTooMuchHTML (mail);
}

exports.mailHasTooMuchHTML = function (mail) {
  if (mail && mail.bodyHTML) {
    var htmlTagRegex = /<[^>]*>/g;
    var matches = mail.bodyHTML.match(htmlTagRegex);
    var badTags = ["<tr", "<td", "<tbody", "<html", "<table", "<body", "<title"];

    if (!matches) {
      return false;
    }
    else if (matches.length > mailReaderConstants.MAX_HTML_TAGS){

      var badTagCount = 0;

      matches.forEach (function (tag) {
        badTags.some (function (badTag){
          if (tag.indexOf (badTag) != -1) {
            badTagCount +=1;
            return true; // this breaks out of the "some"
          }
        });
      });

      if (badTagCount > mailReaderConstants.MAX_HTML_TAGS) {
        winston.doInfo ('mailHTML badTagCount', {len : badTagCount, mailId : mail._id});

        return true;        
      }
      else {
        return false;
      }

    }
    else {
      return false;
    }
  }
}

exports.dedupeAndValidateURLs = function(urls, callback) {

  //winston.doInfo('linkHandler: dedupeAndValidateURLs...', {urls: urls});

  var validURLs = [];
  var validComparableURLs = [];

  if ( ( ! urls ) || ( ! ( urls.length > 0 ) ) ) {
    callback();

  } else {
    async.eachSeries( urls, function(url, eachSeriesCallback) {
      var comparableURL = urlUtils.getComparableURL( url );
      if ( linkHandler.isValidURL( url ) && ( validComparableURLs.indexOf( comparableURL ) === -1 ) ) {
        var urlWithProtocol = urlUtils.addProtocolIfMissing( url );
        validURLs.push( urlWithProtocol );
        validComparableURLs.push( comparableURL );
      } else {
        //winston.doInfo('linkHandler: dedupeAndValidateURLs: url is either invalid or duplicate: ' + url);
      }
      eachSeriesCallback();

    }, function(err) {
      //winston.doInfo ('valid urls', {urls: validURLs});
      callback(err, validURLs);
    });
  }
}

exports.handleValidURLs = function(urls, mail, callback) {

  //winston.doInfo('linkHandler: handleValidURLs...', {mailId: mail._id});

  if ( ( ! urls ) || ( ! ( urls.length > 0 ) ) ) {
    //winston.doWarn('linkHandler: handleValidURLs: urls array is empty');
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
      async.each( urls, function(url, forEachCallback) {
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

  //winston.doInfo('linkHandler: getLinkInfo...', {url: url});

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  var comparableURL = urlUtils.getComparableURL(url);
  var comparableURLHash = urlUtils.hashURL(comparableURL);

  var filter = {
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

  LinkInfoModel.findOneAndUpdate(filter, updateSet, options, function(err, previousLinkInfo) {
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
            linkHandler.followLinkUploadAndSave( linkInfo, userId, function( err, linkFollowData ) {
              if ( err ) {
                //Handle this error here since the link extraction process has moved on...
                winston.handleError(err);

              } else if ( linkInfo.followType == 'fail' ) {
                //No need to index here
                winston.doWarn('linkHandler: getLinkInfo: link following failed, un-promoting links, not indexing', {url: url});
                linkHandler.unpromoteLinks( linkInfo, 'followFail' );

              } else {
                if ( ! linkFollowData ) {
                  winston.doError( 'No linkFollowData, not indexing!', {linkInfoId: linkInfo._id, url: url} );

                } else {
                  //Index the linkInfo
                  //No callback from indexingHandler.  It's all handled internally there.
                  //indexingHandler.indexLinkInfo( linkInfo, linkFollowData );

                  //createIndexingJobForResource = function ( model, isLinkInfo, callback )
                  indexingHandler.createIndexingJobForResource (linkInfo, false, function (err) {
                    if (err) { winston.handleError (err); }
                  });

                }

                //Update all the links
                // TODO: race condition here...?
                linkHandler.updateLinksWithLinkInfo( linkInfo );
              }
            });
          }
        }
      });
    }
  });
}

exports.unpromoteLinks = function( linkInfo, nonPromotableReason ) {

  if ( !  linkInfo ) { winston.doMissingParamError('linkInfo'); return; }
  if ( !  nonPromotableReason ) { winston.doMissingParamError('nonPromotableReason'); return; }
  if ( !  linkInfo.comparableURLHash ) { winston.doMissingParamError('linkInfo.comparableURLHash'); return; }

  //winston.doInfo('linkHandler: unpromoteLinks...', {linkInfoId: linkInfo._id});

  var filter = {
    comparableURLHash: linkInfo.comparableURLHash
  };
  var updateSet = {$set: {
      isPromoted: false
    , nonPromotableReason: nonPromotableReason
  }};

  LinkModel.update( filter, updateSet, {multi: true}, function(err) {
    if ( err ) {
      winston.doMongoError( err );
    }
    //TODO: delete links from index?
  });
}

exports.updateLinksWithLinkInfo = function( linkInfo ) {
  
  if ( !  linkInfo ) { winston.doMissingParamError('linkInfo'); return; }
  if ( !  linkInfo.comparableURLHash ) { winston.doMissingParamError('linkInfo.comparableURLHash'); return; }

  //winston.doInfo('linkHandler: updateLinksWithLinkInfo...', {linkInfoId: linkInfo._id});

  var filter = {
    comparableURLHash: linkInfo.comparableURLHash
  };
  var updateSet = {$set: {
  }};
  var doUpdate = false;
  if ( linkInfo.image ) {
    updateSet['$set']['image'] = linkInfo.image;
    doUpdate = true;
  }
  if ( linkInfo.imageThumbExists ) {
    updateSet['$set']['imageThumbExists'] = linkInfo.imageThumbExists;
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

  LinkModel.update( filter, updateSet, {multi: true}, function(err) {
    if ( err ) {
      winston.doMongoError( err );
    }
  });
}

exports.updloadLinkInfoDataToCloud = function( linkInfo, cloudData, mimeType, callback ) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  if ( ! cloudData ) { callback( winston.makeMissingParamError('cloudData') ); return; }
  if ( ! mimeType ) { callback( winston.makeMissingParamError('mimeType') ); return; }

  //winston.doInfo('linkHandler: updloadLinkInfoDataToCloud...', {linkInfoId: linkInfo._id});

  var cloudPath = cloudStorageUtils.getLinkInfoPath( linkInfo );
  var headers = {
    'Content-Type': mimeType
  }
  var useGzip = true;
  var useAzure = false;

  cloudStorageUtils.putBuffer( cloudData, cloudPath, headers, useGzip, useAzure, function(err) {
    if ( err ) {
      var query = {_id : linkInfo._id};
      cloudStorageUtils.markFailedUpload (LinkInfoModel, 'linkInfo', query);
      callback( err );
    } else {
      callback();
    }
  });
}

exports.handleValidURL = function(url, mail, callback) {

  //winston.doInfo('linkHandler: handleValidURL...', {url: url});

  linkHandler.isPromotable( url, mail, function(err, isPromotable, nonPromotableReason ) {
    if ( err ) {
      callback(err);

    } else if ( ! isPromotable ) {
      //Save non-promoted link
      //winston.doInfo('non-promotable link', {url: url});
      linkHandler.buildAndSaveLink( url, mail, false, nonPromotableReason, callback);
      
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

          linkHandler.buildAndSaveLink( url, mail, true, null, function( err, link ) {
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

                      //createIndexingJobForResourceMeta = function ( model, isLink, cb)
                      indexingHandler.createIndexingJobForResourceMeta (link, false, function (err) {
                        if (err) { winston.handleError (err); }
                      });

                      //No callback from indexingHandler.  It's all handled internally there.
                      callback();
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
  
  //winston.doInfo('linkHandler: updateLinkFromLinkInfo...', {linkInfoId: linkInfo._id});

  var filter = {
      _id: link._id
    , shardKey: mongoUtils.getShardKeyHash( link.userId )
  };

  var updateSet = {$set: {
    linkInfoId: linkInfo._id
  }};
  if ( linkInfo.image ) {
    link.image = linkInfo.image;
    updateSet['$set']['image'] = linkInfo.image;
  }
  if ( linkInfo.imageThumbExists ) {
    link.imageThumbExists = linkInfo.imageThumbExists;
    updateSet['$set']['imageThumbExists'] = linkInfo.imageThumbExists;    
  }
  if ( linkInfo.title ) {
    link.title = linkInfo.title;
    updateSet['$set']['title'] = linkInfo.title;
  }
  if ( linkInfo.summary ) {
    link.summary = linkInfo.summary;
    updateSet['$set']['summary'] = linkInfo.summary;
  }
  
  LinkModel.findOneAndUpdate( filter, updateSet, function(err) {
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

  var contactData = mail.senderContactData;

  if ( ( ! contactData )
    || ( ( typeof contactData.sent ) == 'undefined' )
    || ( ( typeof contactData.corecipient ) == 'undefined' ) ) {
    //senderContactData should have been set already
    callback( winston.makeMissingParamError('mail.senderContactData') );

  } else if ( contactData.sent + contactData.corecipient < mailReaderConstants.MIN_SENT_AND_CORECEIVE )  {
    //winston.doInfo('linkHandler: isPromotableWithData: url is not promotable because contact sent and corecipient are both zero');
    callback( null, false, 'sender' );

  } else if ( utils.containsSubstringFromArray( url, mailReaderConstants.URL_FILTER_TEXT ) ) {
    //winston.doWarn('linkHandler: isPromotable: url is not promotable because of filter text', {url: url});
    callback( null, false, 'text' );

  } else {
    linkHandler.getNumDuplicateLinksForUser( url, mail.userId, function( err, numDuplicateLinks ) {
      if ( err ) {
        callback( err );

      } else if ( numDuplicateLinks && ( numDuplicateLinks > mailReaderConstants.MAX_DUPLICATE_LINKS_FOR_USER ) ) {
        callback( null, false, 'duplicates' );

      } else {
        callback( null, true );
      }
    });
  }
}

exports.getNumDuplicateLinksForUser = function( url, userId, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! userId ) { callback( winston.makeMissingParamError('userId') ); return; }

  //winston.doInfo('linkHandler: getNumDuplicateLinksForUser...', {url: url});

  var comparableURLHash = urlUtils.getComparableURLHash( url );
  LinkModel.count({userId: userId, comparableURLHash: comparableURLHash}, function(err, numDuplicateLinks) {
    if ( err ) {
      callback( winston.makeMongoError(err) );

    } else {
      callback( null, numDuplicateLinks );
    }
  });
}

exports.checkAndHandleDuplicateOnThread = function( url, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! mail.userId ) { callback( winston.makeMissingParamError('mail.userId') ); return; }
  if ( ! mail.gmThreadId ) { callback( winston.makeMissingParamError('mail.gmThreadId') ); return; }

  //winston.doInfo('linkHandler: checkAndHandleDuplicateOnThread...', {url: url, mailId: mail._id});

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
      winston.doInfo('linkHandler: checkAndHandleDuplicateOnThread: duplicate found on later message', {url: url, mailId: mail._id});
      linkHandler.updateLinkForMail( foundLink, url, mail, function(err) {
        if ( err ) {
          callback(err);
        } else {

          // TODO: replace with queue job...
          indexingHandler.updateLink( foundLink, mail );
          //No callback from indexingHandler.  It's all handled internally there.
          callback( null, true );
        }
      });

    } else {
      //This link already exists on an earlier mail in this thread,
      // so just ignore it and move on...
      winston.doInfo('linkHandler: checkAndHandleDuplicateOnThread: duplicate found on earlier message', {url: url, mailId: mail._id});
      callback(null, true);
    }
  });
}

exports.updateLinkForMail = function( link, url, mail, callback ) {

  if ( ! link ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('linkHandler: updateLinkForMail...', {url: url, mailId: mail._id, linkId: link._id});

  var filter = {
      _id: link._id
    , shardKey: mongoUtils.getShardKeyHash( link.userId )
  };

  var updateSet = { $set: {
      mailId: mail._id
    , url: url
    , comparableURLHash: urlUtils.getComparableURLHash( url )
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
    , gmMsgHex : mailUtils.getHexValue (mail.gmMsgId)
  }};

  if ( mailReaderConf.storeMailBody ) {
    updateSet['$set']['mailBodyText'] = mail.bodyText;
    updateSet['$set']['mailBodyHTML'] = mail.bodyHTML;
  }

  LinkModel.findOneAndUpdate(filter, updateSet, function(err, updatedLink) {
    if ( err ) {
      callback( winston.makeMongoError(err) );

    } else {
      callback();
    }
  });
}

exports.buildAndSaveLink = function( url, mail, isPromoted, nonPromotableReason, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('linkHandler: buildAndSaveLink...', {url: url, mailId: mail._id});

  var link = linkHandler.buildLink( url, mail, isPromoted, nonPromotableReason );
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

exports.buildLink = function( url, mail, isPromoted, nonPromotableReason ) {

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
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
    , gmMsgHex : mailUtils.getHexValue (mail.gmMsgId)
    , shardKey: mongoUtils.getShardKeyHash( mail.userId )
  });

  if ( mailReaderConf.storeMailBody ) {
    link['mailBodyText'] = mail.bodyText;
    link['mailBodyHTML'] = mail.bodyHTML;
  }

  if ( nonPromotableReason ) {
    link.nonPromotableReason = nonPromotableReason;
  }

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
//Upon callback, if the followType != 'fail' and the linkFollowData != '', it will be indexed.
//Errors are expected to be handled here, not called back.
exports.followLinkUploadAndSave = function( linkInfo, userId, callback ) {

  //winston.doInfo('linkHandler: followLinkUploadAndSave...', {linkInfoId: linkInfo._id});

  linkInfo.lastFollowDate = new Date();
  linkInfo.followType = 'fail'; //Start with fail, update to success.
  linkHandler.followLink( linkInfo, userId, function( err, linkFollowData, mimeType ) {
    if ( err ) {
      winston.handleError( err );
      //Hopefully setting followType to 'fail' here is unnecessary.
      // followLink() should not have changed the followType if there was an error.
      linkInfo.followType = 'fail';
      callback();

    } else {
      if ( ! linkFollowData ) {
        var warnData = {followType: linkInfo.followType, url: linkHandler.getRealURL( linkInfo )};
        winston.doWarn('linkHandler: followLinkUploadAndSave: empty linkFollowData', warnData);
        linkInfo.followType = 'fail';
        callback();

      } else if ( linkInfo.followType == 'fail' ) {
        var warnData = {url: linkHandler.getRealURL( linkInfo )};
        winston.doWarn('linkHandler: followLinkUploadAndSave: following failed', warnData);
        callback();

      } else {
        linkHandler.updloadLinkInfoDataToCloud( linkInfo, linkFollowData, mimeType, function( err ) {
          if ( err ) {
            winston.handleError( err );
          }
          callback( null, linkFollowData );
        });
      }
    }

    //Always save the link info...
    linkHandler.updateLinkInfoAfterFollowingLink( linkInfo, function(err) {
      if ( err ) {
        winston.handleError( err );
      }
    });
  });
}

exports.followLink = function( linkInfo, userId, callback ) {

  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  //winston.doInfo('linkHandler: followLink...', {url: url, linkInfoId: linkInfo._id});

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

  //winston.doInfo('linkHandler: followDiffbotLink...', {url: url, linkInfoId: linkInfo._id});

  var diffbotData = {
      uri: url
    , summary: true
    , tags: true
    , stats: true
  }

  try {
    diffbot.article( diffbotData, function(err, response) {

      if ( err || ( ! response ) || ( response.errorCode ) ) {
        var warnData = {err: err, response: response, url: url};
        if ( response ) {
          warnData['responseErrorCode'] = response.errorCode;
        }
        winston.doWarn('linkHandler: followDiffbotLink: diffbot failed', warnData);

        // TODO: check why there was a failure before following directly


        linkHandler.followLinkDirectly( linkInfo, callback );
      
      } else {
        linkHandler.processDiffbotResponse( response, linkInfo, callback );
      }
    });
  } catch ( diffbotError ) {
    winston.doWarn('linkHandler: followDiffbotLink: diffbot threw an exception', {diffbotError: diffbotError, url: url});
    linkHandler.followLinkDirectly( linkInfo, callback );
  }
}

exports.processDiffbotResponse = function(diffbotResponse, linkInfo, callback) {

  //winston.doInfo('linkHandler: processDiffbotResponse...', {linkInfoId: linkInfo._id});

  if ( ! diffbotResponse ) { callback( winston.makeMissingParamError('diffbotResponse') ); return; }
  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }

  var imageURL = linkHandler.getImageURLFromDiffbotResponse( diffbotResponse );

  var url = linkHandler.getRealURL( linkInfo );

  if ( urlUtils.isYoutubeURL( url ) ) {
    var youtubeImageURL = urlUtils.getYoutubeImageURL( url );
    if ( youtubeImageURL ) {
      imageURL = youtubeImageURL;
    }
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

  linkHandler.addImageToLinkInfo( linkInfo, imageURL, function(err) {
    if ( err ) {
      callback( err );

    } else {
      var mimeType = 'text/html';
      var packagedDiffbotResponse = indexingHandler.packageDiffbotResponseInHTML( diffbotResponse );
      linkInfo.followType = 'diffbot';
      callback( null, packagedDiffbotResponse, mimeType );
    }
  });
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

  //winston.doInfo('linkHandler: updateLinkInfoAfterFollowingLink...', {linkInfoId: linkInfo._id});

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

  //winston.doInfo('linkHandler: followPDFLink...', {linkInfoId: linkInfo._id});

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

  //winston.doInfo('linkHandler: followGoogleDocLink...', {linkInfoId: linkInfo._id});

  var googleDocId = urlUtils.extractGoogleDocId( url );
  if ( ! googleDocId ) {
    winston.doWarn('linkHandler: followGoogleDocLink: no googleDocId', {url: url});
    callback();
    return;
  }

  googleUtils.getAccessToken( userId, function(err, accessToken) {
    if ( err ) {
      callback( err );

    } else if ( ! accessToken ) {
      callback( winston.makeError('missing accessToken', {userId: userId, linkInfoId: linkInfo._id}) );

    } else {
      var docMetadataURL = mailReaderConf.googleDriveAPIFileGetPrefix + googleDocId + '?access_token=' + accessToken;

      request( docMetadataURL, function(err, response, docMetadata) {
        if ( err ) {
          var warnData = {err: err, linkInfoId: linkInfo._id};
          winston.doWarn('linkHandler: followGoogleDocLink: failed getting metadata', warnData);
          callback();

        } else if ( ! docMetadata ) {
          var warnData = {linkInfoId: linkInfo._id};
          winston.doWarn('linkHandler: followGoogleDocLink: no docMetadata', warnData);
          callback();

        } else {
          linkHandler.getGoogleDocImageTitleSummaryAndData( linkInfo, docMetadata, accessToken, function( err, docData, mimeType ) {
            if ( err ) {
              winston.handleError( err );
              callback();

            } else {
              if ( ! docData ) {
                var warnData = {linkInfoId: linkInfo._id};
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

//callback expected arguments: function( err, docData, mimeType )
exports.getGoogleDocImageTitleSummaryAndData = function( linkInfo, docMetadataRaw, accessToken, callback ) {

  if ( ! docMetadataRaw ) { callback( winston.makeMissingParamError('docMetadataRaw') ); return; }
  if ( ! accessToken ) { callback( winston.makeMissingParamError('accessToken') ); return; }

  //winston.doInfo('linkHandler: getGoogleDocImageTitleSummaryAndData...', {linkInfoId: linkInfo._id});

  try {
    var docMetadata = JSON.parse( docMetadataRaw );
  } catch ( exception ) {
    callback( winston.makeError('failure parsing google doc metadata', {exception: exception, docMetadataRaw: docMetadataRaw}) );
    return;
  }

  //TODO: get doc thumbnail
  //See https://developers.google.com/drive/v2/reference/files#resource and look for thumbnailLink

  var thumbnailLink = docMetadata['thumbnailLink'];
  if ( thumbnailLink ) {
    if ( thumbnailLink.indexOf('?') === -1 ) {
      thumbnailLink += '?';
    } else {
      thumbnailLink += '&';
    }
    thumbnailLink += 'access_token=' + accessToken;
  }

  linkHandler.addImageToLinkInfo( linkInfo, thumbnailLink, function(err) {
    if ( err ) {
      callback( err );

    } else {
      var mimeType = '';
      linkInfo.title = docMetadata['title'];
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
        winston.doWarn('linkHandler: getGoogleDocTitleSummaryAndData: no valid export link', {linkInfoId: linkInfo._id})
        callback( null, null, mimeType );

      } else {
        if ( exportLink.indexOf('?') === -1 ) {
          exportLink += '?';
        } else {
          exportLink += '&';
        }
        exportLink += 'access_token=' + accessToken;

        request( exportLink, function(err, response, docData ) {
          if ( err ) {
            callback( winston.makeError('export request error', {err: err.toString(), linkInfoId: linkInfo._id}) );

          } else if ( ! docData ) {
            winston.doWarn('linkHandler: getGoogleDocTitleSummaryAndData: no docData', {linkInfoId: linkInfo._id});
            callback( null, null, mimeType );

          } else {
            if ( mimeType == 'text/html' ) {
              linkInfo.summary = linkHandler.extractSummaryFromHTML( docData );
            } else if ( mimeType == 'text/plain' ) {
              linkInfo.summary = docData.substring(0, mailReaderConstants.LINK_SUMMARY_CUTOFF);
            }
            callback( null, docData, mimeType );
          }
        });
      }
    }
  });
}

exports.addImageToLinkInfo = function( linkInfo, imageURL, callback ) {

  if ( ! imageURL ) { callback(); return; } //This case is actually expected...it makes things cleaner for the caller.
  if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }

  //winston.doInfo('linkHandler: addImageToLinkInfo...', {linkInfoId: linkInfo._id});

  cloudStorageUtils.downloadAndSaveStaticImage( imageURL, function ( err, imagePath ) {
    if ( err ) {
      callback( err );

    } else {
      if ( imagePath ) {
        linkInfo.image = imagePath;

        // make job to generate thumbnail
        var thumbnailJob = {
          comparableURLHash : linkInfo.comparableURLHash,
          cloudPath : imagePath,
          isRollover : true,
          resourceId : linkInfo._id,
          jobType : 'thumbnail',
          modelName : 'LinkInfo'
        }

        sqsConnect.addMessageToWorkerQueue (thumbnailJob, function (err) {
          if (err) {
            winston.doError ('Could not add thumbnail job to worker queue', {job : job});          
          }
        });  
      }

      callback();
    }
  });
}



exports.followLinkDirectly = function(linkInfo, callback) {

 if ( ! linkInfo ) { callback( winston.makeMissingParamError('linkInfo') ); return; }
  var url = linkHandler.getRealURL( linkInfo );
  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }

  //winston.doInfo('linkHandler: followLinkDirectly...', {linkInfoId: linkInfo._id});

  urlUtils.resolveURL( url, function( err, resolvedURL, isHTTPS, response ) {
    if ( err || ( ! response ) || ( ! response.body ) || ( response.statusCode !== 200 ) ) {
      var warnData = {err: err, url: url};
      if ( response ) {
        warnData.statusCode = response.statusCode;
      }
      
      winston.doWarn( 'linkHandler: followLinkDirectly: bad response from resolveURL', warnData );
      callback();

    } else {

      if (response.headers 
        && response.headers['content-type'] 
        && response.headers['content-type'].indexOf ('text/html') != -1) {
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
      else if (response.headers && response.headers['content-type'] == 'application/pdf') {
        var pdfData = response.body;
        var mimeType = 'application/pdf';
        linkInfo.followType = 'pdf';
        callback( null, pdfData, mimeType );      
      }
      else {
        winston.doWarn( 'linkHandler: followLinkDirectly: response content not an html page or pdf', 
          {contentType : response.headers['content-type'], url : url});
        
        callback ();
      }

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

  var regex = new RegExp("<" + field + "[\\s\\S]*?>([\\s\\S]*?)<\/" + field + ">");
  var match = html.match(regex);

  if (match && match.length > 1) {
    return linkHandler.stripHtml(match[1]);
  }
  else {
    return '';
  }

}

exports.stripHtml = function (str) {
  if (str) {
    var regex = /(<([^>]+)>)/ig;
    return str.replace(regex, " ").replace(/\s{2,}/g," ").replace(/\&nbsp;/g, "").replace (/ [\.\?\!]/g, ".").trim();
  }
  else{
    return str
  }
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

  var match = html.match(/<meta name="description" content="([\s\S]*?)"/);

  if (match && match.length > 1) {
    return match[1].trim()
  }
  else {
    return '';
  }

}