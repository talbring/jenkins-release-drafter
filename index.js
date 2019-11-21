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
const log = require('./lib/log')

const configName = 'release-drafter.yml'

module.exports = app => {
  app.on('push', async context => {
    const defaults = {
      branches: context.payload.repository.default_branch,
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

    // GitHub Actions merge payloads slightly differ, in that their ref points
    // to the PR branch instead of refs/heads/master
    const ref = process.env['GITHUB_REF'] || context.payload.ref
    const sha = 'untagged-' + context.payload.after.substring(0, 7)
    const branch = ref.replace(/^refs\/heads\//, '')
    if (!config.template) {
      log({ app, context, message: 'No valid config found' })
      return
    }

    if (!isTriggerableBranch({ branch, app, context, config })) {
      return
    }

    const { draftRelease, lastRelease } = await findReleases({ app, context })

    var assetFound = false
    if (draftRelease) {
      if (draftRelease.tag_name == sha) {
        assetFound = true
      }
    }
    if (!assetFound) {
      let currentRelease

      // Update the tag name of the current draft release or create a new one if no draft can be found
      if (!draftRelease) {
        log({ app, context, message: 'Creating new draft release' })
        currentRelease = await context.github.repos.createRelease(
          context.repo({
            tag_name: sha,
            draft: true
          })
        )
      } else {
        log({ app, context, message: 'Updating existing draft release' })
        await context.github.repos.updateRelease(
          context.repo({
            release_id: draftRelease.id,
            tag_name: sha
          })
        )
        currentRelease = await context.github.repos.getRelease(
          context.repo({
            release_id: draftRelease.id
          })
        )
      }

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

      log({ app, context, message: 'Updating draft release body' })
      await context.github.repos.updateRelease(
        context.repo({
          release_id: currentRelease.data.id,
          body: releaseInfo.body
        })
      )

      for (var asset in currentRelease.data.assets) {
        await context.github.repos.deleteReleaseAsset(
          context.repo({
            asset_id: currentRelease.data.assets[asset].id
          })
        )
      }
      console.log('::set-output name=tagname::' + currentRelease.data.tag_name)
      console.log(
        '::set-output name=uploadurl::' + currentRelease.data.upload_url
      )
    } else {
      log({
        app,
        context,
        message: 'Matching assets found. Change log already up-to-date.'
      })
      console.log('::set-output name=tagname::' + draftRelease.tag_name)
      console.log('::set-output name=uploadurl::' + draftRelease.upload_url)
    }
  })
}
