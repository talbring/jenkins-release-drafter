module.exports = ({ app, context, message, info }) => {
  const logString = `${message}`

  if (info) {
    console.log(logString + ' ' + info)
  } else {
    console.log(logString)
  }
}
