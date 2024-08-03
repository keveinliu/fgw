import makeBackendSelector from './backend-selector.js'
import makeBalancer from './balancer-tcp.js'
import { log } from '../utils.js'

var $ctx
var $selection

export default function (listener, routeResources) {
  var shutdown = pipeline($=>$.replaceStreamStart(new StreamEnd))

  var selector = makeBackendSelector(
    'tcp', listener,
    routeResources[0]?.spec?.rules?.[0],
    function (backendRef, backendResource, filters) {
      var forwarder = backendResource ? makeBalancer(backendRef, backendResource) : shutdown
      return pipeline($=>$
        .pipe([...filters, forwarder], () => $ctx)
        .onEnd(() => $selection.free?.())
      )
    }
  )

  function route() {
    $selection = selector()
    log?.(
      `Inb #${$ctx.inbound.id}`,
      `backend ${$selection?.target?.backendRef?.name}`
    )
  }

  return pipeline($=>$
    .onStart(c => {
      $ctx = c
      route()
    })
    .pipe(() => $selection ? $selection.target.pipeline : shutdown)
  )
}