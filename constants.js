
function define(name, value) {
  Object.defineProperty(exports, name, {
    value : value,
    enumerable: true
  });
}


define('STREAM_ATTACHMENTS', true);

define('MAX_WORKERS', 15);

define('WORKER_TIMEOUT', 5*60*1000);

define('MIN_IMAGE_FILE_SIZE', 15000);

define('PDF_DOWNLOAD_TIMEOUT', 20000);

define ('MAX_HTML_TAGS', 30);

define ('MAX_LINKS_PER_MAIL', 300);

define('MAX_DUPLICATE_LINKS_FOR_USER', 4);

define ('MAX_URL_LENGTH', 400);

define ('MAX_TRIES_MAILREADER', 8);

define ('RECIPIENT_BLACKLIST', ['no-reply@coursework.stanford.edu', 'no-reply@coursework.edu']);

define ('ERROR_TYPE_HARD_FAIL', 'hardFail');