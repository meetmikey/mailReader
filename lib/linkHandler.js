var serverCommon = process.env.SERVER_COMMON;

var utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , urlUtils = require(serverCommon + '/lib/urlUtils')
  , linkUtils = require(serverCommon + '/lib/linkUtils')
  , followLinkUtils = require(serverCommon + '/lib/followLinkUtils')
  , mongoUtils = require(serverCommon + '/lib/mongoUtils')
  , contactUtils = require(serverCommon + '/lib/contactUtils')
  , async = require('async')
  , fs = require('fs')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , LinkInfoModel = require(serverCommon + '/schema/linkInfo').LinkInfoModel
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , indexingHandler = require (serverCommon + '/lib/indexingHandler')
  , mailReaderConstants = require('../constants')
  , mailReaderConf = require('../conf');

var linkHandler = this;

exports.extractLinks = function(parsedMail, mail, callback) {

  //winston.doInfo('linkHandler: extractLinks...', {mailId: mail._id});

  if ( ! parsedMail ) { callback( winston.makeMissingParamError('parsedMail') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  if ( linkHandler.shouldIgnoreEmail(mail) ) {
    linkHandler.setMailLinkExtractorState(mail, 'ignored', callback);

  } else if ( linkHandler.mailHasTooMuchHTML (mail) ) {
    linkHandler.setMailLinkExtractorState(mail, 'tooMuchHTML', callback);

  } else {

    var matchedURLs = linkHandler.findURLs( parsedMail, mail._id );

    if ( ( ! matchedURLs ) || ( matchedURLs.length == 0 ) ) {
      linkHandler.setMailLinkExtractorState(mail, 'noLinks', callback);

    } else if (matchedURLs.length > mailReaderConstants.MAX_LINKS_PER_MAIL) {
      linkHandler.setMailLinkExtractorState(mail, 'tooManyLinks', callback);

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
    var dirtyURLs = source.match(regEx);
    var cleanURLs = urlUtils.cleanURLs( dirtyURLs );
    return cleanURLs;
  }
}

exports.setMailLinkExtractorState = function(mail, state, callback) {

  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return ; }

  var filter = {
    _id: mail._id
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

  return mail.hasMarketingFrom || mail.hasMarketingText;
}


exports.mailHasTooMuchHTML = function (mail) {
  if (mail && mail.bodyHTML) {
    var htmlTagRegex = /<[^>]*>/g;
    var matches = mail.bodyHTML.match(htmlTagRegex);
    var badTags = ["<tr", "<td", "<tbody", "<table", "<title"];

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
      if ( linkUtils.isValidURL( url ) && ( validComparableURLs.indexOf( comparableURL ) === -1 ) ) {
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

  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('linkHandler: handleValidURLs...', {mailId: mail._id});

  if ( ( ! urls ) || ( ! ( urls.length > 0 ) ) ) {
    //winston.doWarn('linkHandler: handleValidURLs: urls array is empty');
    callback();
    return;
  }
  
  //Get the contact data once here at the beginning, so we can process all the URLs in parallel
  contactUtils.getContactData( mail.userId, mail.sender.email, function(err, contactData, isSentByUser) {
    if ( err ) {
      callback( err );

    } else if ( ! contactData ) {
      callback( winston.makeError('no contact data found', {mailId: mail._id, userId: mail.userId, senderEmail: mail.sender.email}) );

    } else {
      mail.senderContactData = contactData;
      mail.isSentByUser = isSentByUser;
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

exports.handleValidURL = function( url, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('linkHandler: handleValidURL...', {url: url});

  linkHandler.lookForDuplicateOnThread( url, mail, function( err, isDuplicateOnThread, needsUpdateToMail, link ) {
    if ( err ) {
      callback( err );

    } else if ( isDuplicateOnThread ) {
      if ( ! needsUpdateToMail ) { //Nothing to do, really.
        callback();

      } else { //old link, needs updating changed
        linkHandler.handleThreadDuplicateUpdate( link, mail, callback );
      }

    } else { //new link
      linkHandler.handleNewURLOnThread( url, mail, callback );
    }
  });
}

//Only runs when we need to update this link to the current mail
exports.handleThreadDuplicateUpdate = function( link, mail, callback ) {

  if ( ! link ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  var wasPromoted = false;
  if ( link.isPromoted ) {
    wasPromoted = true;
  }

  linkHandler.updateLinkToMail( link, mail, function(err, havePropertiesChanged) {
    if ( err ) {
      callback( err );

    } else if (!havePropertiesChanged) {
      callback ();

    } else if ( ! link.isPromoted ) {
      
      if ( wasPromoted ) {
        indexingHandler.deleteResourceMetadata( link, true, callback );
      } else {
        callback();
      }

    } else if ( ! wasPromoted ) { //link is newly promoted
      linkUtils.getLinkInfoAndUpdateLink( link, callback );

    } else { //links is promoted, but it was before too
      if ( link.isFollowed ) {
        indexingHandler.createIndexingJobForDocument( link, true, false, callback );

      } else {
        callback();
      }
    }
  });
}

exports.checkAndMarkLinkPromoted = function( link, mail, isLinkAlreadyInDB, callback ) {

  if ( ! link ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  linkUtils.checkAndMarkLinkPromoted( link, mail.senderContactData, mail.isSentByUser, isLinkAlreadyInDB, callback );
};

//The callback here should pass the following arguments:
// callback( error, duplicateFoundOnThread, needsUpdateToMail, foundLink )
exports.lookForDuplicateOnThread = function( url, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! mail.userId ) { callback( winston.makeMissingParamError('mail.userId') ); return; }
  if ( ! mail.gmThreadId ) { callback( winston.makeMissingParamError('mail.gmThreadId') ); return; }

  //winston.doInfo('linkHandler: lookForDuplicateOnThread...', {url: url, mailId: mail._id});

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
      callback( null, false );

    } else if ( mail.sentDate.getTime() < foundLink.sentDate.getTime() ) {
      winston.doInfo('linkHandler: lookForDuplicateOnThread: duplicate found on later message', {url: url, mailId: mail._id});
      callback( null, true, true, foundLink );

    } else {
      //This link already exists on an earlier mail in this thread...
      winston.doInfo('linkHandler: lookForDuplicateOnThread: duplicate found on earlier message', {url: url, mailId: mail._id});
      callback( null, true, false, foundLink );
    }
  });
}

exports.handleNewURLOnThread = function( url, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  linkHandler.buildAndSaveLink( url, mail, function( err, uniqueKeyException, link ) {
    if ( err ) {
      callback( err );

    } else if (uniqueKeyException && link) {

      // compare times to see if we need to update
      if ( mail.sentDate.getTime() < link.sentDate.getTime() ) {
        // link here is the duplicate we found in mongo, not a new link
        linkHandler.handleThreadDuplicateUpdate( link, mail, callback );        
      } else {
        callback ();
      }


    } else if ( ! link ) {
      callback( winston.makeError('no link from buildAndSaveLink') );

    } else if ( ! link.isPromoted ) {
      //Note: in this case, the link has not been saved to mongo.
      callback();

    } else {
      linkUtils.getLinkInfoAndUpdateLink( link, callback );
    }
  });
}

exports.updateLinkToMail = function( link, mail, callback ) {

  if ( ! link ) { callback( winston.makeMissingParamError('link') ); return; }
  if ( ! link.url ) { callback( winston.makeMissingParamError('link.url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  var url = link.url;

  //winston.doInfo('linkHandler: updateLinkToMail...', {url: url, mailId: mail._id, linkId: link._id});

  var filter = {
      '_id': link._id
    , 'sentDate' : { $gt : mail.sentDate }
  };

  var updateSet = {
      $set: {
          mailId: mail._id
        , url: url
        , comparableURLHash: urlUtils.getComparableURLHash( url )
        , sentDate: mail.sentDate
        , sender: mailUtils.copySender( mail.sender )
        , recipients: mail.recipients
        , mailCleanSubject: mail.cleanSubject
        , gmThreadId: mail.gmThreadId
        , gmMsgId: mail.gmMsgId
        , gmMsgHex: mailUtils.getHexValue( mail.gmMsgId )
      }
    , $unset: {
      }
  };

  linkHandler.checkAndMarkLinkPromoted( link, mail, true, function( err ) {
    if ( err ) {
      callback( err );

    } else {

      if ( link.isPromoted ) {
        updateSet['$set']['isPromoted'] = true;
        updateSet['$unset']['nonPromotableReason'] = 1;
      } else {
        //Note: now that we're not saving non-promoted links, we need to re-think what should happen with
        // this link.  Sagar will come back here when doing his re-indexing work.
        updateSet['$unset']['isPromoted'] = 1;
        updateSet['$set']['nonPromotableReason'] = link.nonPromotableReason;
      }

      var havePropertiesChanged = true;

      LinkModel.findOneAndUpdate(filter, updateSet, function(err, updatedLink) {
        if ( err ) {
          callback( winston.makeMongoError(err) );

        } else if ( ! updatedLink ) {
          havePropertiesChanged = false;
          winston.doInfo ('Link properties were not changed', filter)
          link = undefined;
          callback( null, havePropertiesChanged );

        } else {
          link = updatedLink;
          callback(null, havePropertiesChanged);
        }
      });
    }
  });

}

exports.buildAndSaveLink = function( url, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  //winston.doInfo('linkHandler: buildAndSaveLink...', {url: url, mailId: mail._id});

  linkHandler.buildLink( url, mail, function( err, link ) {
    if ( err ) {
      callback( err );

    } else if ( ! link ) {
      callback( winston.makeError('failed to build link') );

    } else if ( ! link.isPromoted ) {
      callback( null, false, link );

    } else {
      link.save( function(err) {
        if ( err ) {
          // duplicate exception from mongo, caused by race condition
          // switch to "update path"
          if (err.code == 11000) {
            var filter = {
              userId : link.userId, 
              gmThreadId : link.gmThreadId, 
              comparableURLHash : link.comparableURLHash
            };

            winston.doWarn ('Duplicate link on thread for this user', filter);
          
            // get the thing that caused the duplicate exception so we can go down the duplicate path
            LinkModel.findOne (filter)
              .exec (function (err, dupeLink) {
                if (err) {
                  callback (winston.makeMongoError (err));
                }
                else {
                  callback (null, true, dupeLink);
                }
              });
          }
          else {
            callback( winston.makeMongoError(err));
          }
        } else {
          callback( null, false, link );
        }
      });
    }
  });
}

exports.buildLink = function( url, mail, callback ) {

  if ( ! url ) { callback( winston.makeMissingParamError('url') ); return; }
  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }

  var link = new LinkModel({
      userId: mail.userId
    , mailId: mail._id
    , url: url
    , comparableURLHash: urlUtils.getComparableURLHash( url )
    , sentDate: mail.sentDate
    , sender: mailUtils.copySender( mail.sender )
    , recipients: mail.recipients
    , mailCleanSubject: mail.cleanSubject
    , gmThreadId: mail.gmThreadId
    , gmMsgId: mail.gmMsgId
    , gmMsgHex : mailUtils.getHexValue (mail.gmMsgId)
  });

  if ( mailReaderConf.storeMailBody ) {
    link['mailBodyText'] = mail.bodyText;
    link['mailBodyHTML'] = mail.bodyHTML;
  }

  linkHandler.checkAndMarkLinkPromoted( link, mail, false, function( err ) {
    if ( err ) {
      callback( err );

    } else {
      callback( null, link );
    }
  });
}