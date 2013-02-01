var environment = process.env.NODE_ENV
var base = process.env.MAGIC_SERVER_BASE

module.exports = {
  mongo: {
    local: {
      host: 'localhost',
      db: 'meetmikey',
      user: 'mikey',
      port: 27017,
    }
  }
}