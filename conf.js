var environment = process.env.NODE_ENV

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