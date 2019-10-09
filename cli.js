const getConfig = require('probot-config')
const { isTriggerableBranch } = require('./lib/triggerable-branch')
const { findReleases, generateReleaseInfo } = require('./lib/releases')
const { findCommitsWithAssociatedPullRequests } = require('./lib/commits')
const { validateReplacers } = require('./lib/template')
const {
  validateSortDirection,
  sortPullRequests,
  SORT_DIRECTIONS
} = require('./lib/sort-pull-requests')

const log = require('./lib/log-cli')

const configName = 'release-drafter.yml'

var context = {
  name: string,
  id: string,
  payload: E,
  //protocol?: 'http' | 'https',
  //host?: string
  //url?: string
  github: new GitHubAPI(),
  log: new LoggerWithTarget()
}
_main(null, context)

async function _main(app, context) {
  const defaults = {
    branches: null,
    'change-template': `* $TITLE (#$NUMBER) @$AUTHOR`,
    'no-changes-template': `* No changes`,
    'version-template': `$MAJOR.$MINOR.$PATCH`,
    categories: [],
    'exclude-labels': [],
    replacers: [],
    'sort-direction': SORT_DIRECTIONS.descending
  }
  console.log('here')
  const config = Object.assign(
    defaults,
    (await getConfig(context, configName)) || {}
  )
  config.replacers = validateReplacers({
    app,
    context,
    replacers: config.replacers
  })
  config['sort-direction'] = validateSortDirection(config['sort-direction'])

  const branch = null

  if (!config.template) {
    log({ app, context, message: 'No valid config found' })
    return
  }

  const { draftRelease, lastRelease } = await findReleases({ app, context })
  const {
    commits,
    pullRequests: mergedPullRequests
  } = await findCommitsWithAssociatedPullRequests({
    app,
    context,
    branch,
    lastRelease
  })

  const sortedMergedPullRequests = sortPullRequests(
    mergedPullRequests,
    config['sort-direction']
  )

  const releaseInfo = generateReleaseInfo({
    commits,
    config,
    lastRelease,
    mergedPullRequests: sortedMergedPullRequests
  })

  log({ app, context, message: 'Release name: ' + releaseInfo.name })
  log({ app, context, message: 'Release tag: ' + releaseInfo.tag })
  log({ app, context, message: releaseInfo.body })
}
