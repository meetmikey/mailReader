
function define(name, value) {
  Object.defineProperty(exports, name, {
    value : value,
    enumerable: true
  });
}


define('STREAM_ATTACHMENTS', true);

define('MAX_WORKERS', 15);

define('WORKER_TIMEOUT', 5*60*1000);

define('MIN_IMAGE_FILE_SIZE', 10000);

define('PDF_DOWNLOAD_TIMEOUT', 20000);

define ('MAX_HTML_TAGS', 30);

define ('MAX_LINKS_PER_MAIL', 200);