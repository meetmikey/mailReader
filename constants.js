
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
  , 'schemas.microsoft.com'
  , 'schema.org'
  , 'magicnotebook.com'
  , 'meetmikey.com'
  , 'email.launchrock.com'
  , 'trypico.com'
  , 'app.yesware.com' // tracking
  , 'paypal.com'
  , 'dmanalytics' // tracking
  , 'facebook.com' // usually requires log in so most
  , 'app.asana.com' // requires login
  , 'googleusercontent.com' // fonts
  , 'www.amazon.com'
  , 'google.ca'
];

define('MAX_WORKERS', 1);

define('MIN_IMAGE_FILE_SIZE', 10000);

define('URL_FILTER_TEXT', urlFilterText);

define('PDF_DOWNLOAD_TIMEOUT', 20000);

define('LINK_SUMMARY_CUTOFF', 300);

define('MAX_DUPLICATE_LINKS_FOR_USER', 4);
