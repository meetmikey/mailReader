
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
  , 'jobvite.com'
  , 'www.w3.org'
  , 'doubleclick.net'
  , 'itunes.apple.com'
  , 'api_key='
  , 'plus.google.com'
  , 'tickets.'
  , 'ticketmaster'
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
  , 'groups.google.com'
  , 's3.amazonaws.com/magicnotebook'
  , 'send.angel.co'
  , 'twitter.com'
  , 'zendesk.com'
  , 'sites.google.com'
  , 'mail.'
  , 'match.com'
  , 'salesforce.com'
  , 'okcupid.com'
  , 'newrelic.com'
  , 'doodle.com'
  , 'feedburner.com'
  , 'joingrouper.com'
  , 'alerts?'
  , 'linkedin.com'
  , 'godaddy.com'
  , 'aa.com'
  , 'jetblue.com'
  , 'delta.com'
  , 'southwest.com'
  , 'virgin.com'
  , 'schemas.openxmlformats.org'
  , 'yousend.it'
  , 'fbstatic'
  , 'cart.rackspace.com'
  , 'tinder.com'
  , 'atlassian.net'
  , 'click'
  , '.py'
  , 'hertz.com'
  , 'esurance.com'
  , 'avis.com'
  , 'aavacations.com'
  , 'office.trapeze.com'
  , 'hotmail.com'
  , 'dealersocket.com'
  , 'airbnb.com'
  , 'united.com'
  , 'mailman.'
  , 'invite'
  , 'zerply.com'
  , 'mail.'
  , 'contactually.com'
  , 'app.asana.com'
  , 'sendgrid'
  , 'abuse'
];

define('STREAM_ATTACHMENTS', true);

define('MAX_WORKERS', 15);

define('WORKER_TIMEOUT', 5*60*1000);

define('MIN_IMAGE_FILE_SIZE', 10000);

define('URL_FILTER_TEXT', urlFilterText);

define('PDF_DOWNLOAD_TIMEOUT', 20000);

define('LINK_SUMMARY_CUTOFF', 300);

define('MAX_DUPLICATE_LINKS_FOR_USER', 4);

define ('MAX_HTML_TAGS', 15);
