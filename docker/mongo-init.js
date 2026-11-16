try {
  const config = rs.conf()
  if (config._id === 'rs0') {
    print('MongoDB replica set rs0 is already initialized')
  }
} catch {
  rs.initiate({
    _id: 'rs0',
    members: [{ _id: 0, host: 'mongodb:27017' }],
  })
  print('MongoDB replica set rs0 initialized')
}
