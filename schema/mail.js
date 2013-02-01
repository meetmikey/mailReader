var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var EmailUserSchema = new Schema({
    name: {type: String}
  , email: {type: String}
});

var EmailUser = {
    name: {type: String}
  , email: {type: String}
};

var Mail = new Schema({
    userId: {type: Schema.ObjectId, index: true, required: true}
  , messageId: {type: String, index: true}
  , sender: EmailUser
  , recipients: {type: [EmailUserSchema]}
  , subject: {type: String}
  , bodyText: {type: String}
  , bodyHTML: {type: String}
  , numAttachments: {type: Number}
  , sentDate: {type: Date, default: Date.now}
  , timestamp: {type: Date, default: Date.now}
});

mongoose.model('Mail', Mail);