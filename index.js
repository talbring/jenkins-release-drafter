const isCLIMode = true // process.env.npm_package_config_writeToCLI || false

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
const log = isCLIMode ? require('./lib/log-cli') : require('./lib/log')

const configName = 'release-drafter.yml'

if (isCLIMode) {
  // CLI mode
  _main(null, null)
} else {
  // Standard mode
  module.exports = app => {
    app.on('push', async context => { _main(app, context) } )
  }
}

async function _main(app, context) {
    const defaults = {
      branches: isCLIMode ? null : context.payload.repository.default_branch,
      'change-template': `* $TITLE (#$NUMBER) @$AUTHOR`,
      'no-changes-template': `* No changes`,
      'version-template': `$MAJOR.$MINOR.$PATCH`,
      categories: [],
      'exclude-labels': [],
      replacers: [],
      'sort-direction': SORT_DIRECTIONS.descending
    }
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

    const branch = isCLIMode ? null : context.payload.ref.replace(/^refs\/heads\//, '')

    if (!config.template) {
      log({ app, context, message: 'No valid config found' })
      return
    }

    if (!isCLIMode && !isTriggerableBranch({ branch, app, context, config })) {
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

    if (isCLIMode) {
      log({ app, context, message: 'Release name: ' + releaseInfo.name })
      log({ app, context, message: 'Release tag: ' + releaseInfo.tag })
      log({ app, context, message: releaseInfo.body }) 
    } else if (!draftRelease) {
      log({ app, context, message: 'Creating new draft release' })
      await context.github.repos.createRelease(
        context.repo({
          name: releaseInfo.name,
          tag_name: releaseInfo.tag,
          body: releaseInfo.body,
          draft: true
        })
      )
    } else {
      log({ app, context, message: 'Updating existing draft release' })
      await context.github.repos.updateRelease(
        context.repo({
          release_id: draftRelease.id,
          body: releaseInfo.body
        })
      )
    }
}
