import resources from './resources.js'
import { logEnable } from './utils.js'
import { startGateway, makeResourceWatcher } from './startup.js'

export default function ({ mesh, app, utils }) {
  var cli = initCLI({ app, mesh, utils })

  logEnable(true)

  resources.initZTM(
    { mesh, app },
    makeResourceWatcher(isLocalGateway)
  ).then(() => {
    resources.list('Gateway').forEach(gw => {
      if (!gw.metadata?.name) return
      if (isLocalGateway(gw)) startGateway(gw)
    })
  })

  function isLocalGateway(gw) {
    var endpoints = gw.spec?.ztm?.endpoints
    if (endpoints instanceof Array) {
      var id = app.endpoint.id
      var name = app.endpoint.name
      return endpoints.some(ep => ep.id === id || ep.name === name)
    }
    return false
  }

  var $ctx

  var serveUser = utils.createServer({
    '/cli': {
      'CONNECT': utils.createCLIResponder(cli),
    },
  })

  var servePeer = utils.createServer({})

  return pipeline($=>$
    .onStart(c => void ($ctx = c))
    .pipe(() => {
      switch ($ctx.source) {
        case 'user': return serveUser
        case 'peer': return servePeer
      }
    })
  )
}

function initCLI({ mesh, app, utils }) {
  return pipeline($=>$
    .onStart(ctx => main(ctx))
  )

  function main({ argv, cwd }) {
    var buffer = new Data

    function output(str) {
      buffer.push(str)
    }

    function error(err) {
      output('ztm: ')
      output(err.message || err.toString())
      output('\n')
    }

    function flush() {
      return Promise.resolve([buffer, new StreamEnd])
    }

    try {
      return utils.parseArgv(argv, {
        help: text => Promise.resolve(output(text + '\n')),
        commands: [
          {
            title: 'Configure Flomesh Gateway with resource files',
            usage: 'config <dir>',
            options: `
              --delete   Delete files that don't exist in the specified directory
            `,
            action: (args) => {
              var meshDir = `/users/${app.username}`
              var localDir = os.path.join(cwd, args['<dir>'])
              return mesh.dir(meshDir).then(meshPaths => {
                var localPaths = []
                listDirTree(localPaths, localDir)
                localPaths.forEach(localPath => {
                  var meshPath = os.path.join(meshDir, localPath)
                  if (!meshPaths.includes(meshPath)) {
                    output(`Create file: ${localPath}\n`)
                    mesh.write(meshPath, os.read(os.path.join(localDir, localPath)))
                  }
                })
                return Promise.all(meshPaths.map(
                  meshPath => {
                    var localPath = meshPath.substring(meshDir.length)
                    var localData = os.read(os.path.join(localDir, localPath))
                    if (localData) {
                      return mesh.read(meshPath).then(data => {
                        if (localData.size !== data?.size || localData.toString() !== data?.toString?.()) {
                          output(`Update file: ${localPath}\n`)
                          mesh.write(meshPath, localData)
                        }
                      })
                    } else if (args['--delete']) {
                      // TODO
                      output(`Delete file: ${localPath}\n`)
                    }
                  }
                ))
              })
            }
          }
        ]

      }).then(flush).catch(err => {
        error(err)
        return flush()
      })

    } catch (err) {
      error(err)
      return flush()
    }
  }
}

function listDirTree(pathnames, dirname, path) {
  path = path || '/'
  var names = os.readDir(os.path.join(dirname, path))
  names.forEach(name => {
    var pathname = os.path.join(path, name)
    if (name.endsWith('/')) {
      listDirTree(pathname)
    } else {
      pathnames.push(pathname)
    }
  })
}
