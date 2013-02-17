
function define(name, value) {
  Object.defineProperty(exports, name, {
    value : value,
    enumerable: true
  });
}

var urlFilterText = [
    'track'
  , 'unsub'
  , 'activate'
  , 'sendgrid.me'
  , 'api.mixpanel.com'
  , 'eventbrite.com'
  , 'evite.com'
  , 'www.w3.org'
  , 'mailchimp.com'
  , 'marketing.typesafe.com'
  , 'google.com/calendar/'
  , 'magicnotebook.com'
  , 'meetmikey.com'
];

define('URL_FILTER_TEXT', urlFilterText);
define('PDF_DOWNLOAD_TIMEOUT', 20000);
define('LINK_TEXT_CUTOFF', 300);