import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath))
}

test('shared core contract documents exist', () => {
  const requiredFiles = [
    'shared/protocol/contracts.md',
    'shared/protocol/cursor-pagination.md',
    'shared/protocol/versioning.md',
    'shared/protocol/rest-schema.json',
    'shared/protocol/ws-schema.json',
    'shared/protocol/message-envelope.schema.json',
    'shared/native-core/README.md',
    'shared/native-core/module.json',
    'shared/domain/models.md',
    'shared/domain/events.md',
    'shared/domain/interfaces.md',
    'shared/domain/repositories.md',
    'shared/domain/auth-session.md',
    'shared/domain/websocket-lifecycle.md',
    'shared/domain/sync-engine.md',
    'shared/crypto-contracts/interfaces.md',
    'shared/test-vectors/manifest.json',
    'shared/test-vectors/x3dh-handshake-vector.json',
    'shared/test-vectors/double-ratchet-sequence-vector.json',
    'shared/test-vectors/sender-key-group-vector.json',
  ]

  for (const file of requiredFiles) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `missing ${file}`)
  }
})

test('domain interfaces document defines required engines', () => {
  const content = readText('shared/domain/interfaces.md')

  assert.match(content, /AuthEngine/)
  assert.match(content, /WSClient/)
  assert.match(content, /MessageRepository/)
})

test('repository contracts document defines core repositories', () => {
  const content = readText('shared/domain/repositories.md')

  assert.match(content, /AuthRepository/)
  assert.match(content, /ChatRepository/)
  assert.match(content, /MessageRepository/)
  assert.match(content, /DeviceRepository/)
  assert.match(content, /MediaRepository/)
  assert.match(content, /SettingsRepository/)
})

test('domain models document covers core shared entities and receipts', () => {
  const content = readText('shared/domain/models.md')

  assert.match(content, /User/)
  assert.match(content, /Chat/)
  assert.match(content, /Message/)
  assert.match(content, /Receipt/)
  assert.match(content, /Attachment/)
  assert.match(content, /Device/)
})

test('crypto contracts document defines crypto engine', () => {
  const content = readText('shared/crypto-contracts/interfaces.md')

  assert.match(content, /CryptoEngine/)
  assert.match(content, /X3DH/)
  assert.match(content, /Double Ratchet/)
  assert.match(content, /Sender Keys/)
})

test('cursor pagination contract is marked mandatory for all clients', () => {
  const content = readText('shared/protocol/cursor-pagination.md')

  assert.match(content, /mandatory/i)
  assert.match(content, /Desktop/)
  assert.match(content, /Android/)
  assert.match(content, /iOS/)
})

test('auth and websocket documents define session lifecycle and reconnect semantics', () => {
  const auth = readText('shared/domain/auth-session.md')
  const ws = readText('shared/domain/websocket-lifecycle.md')
  const sync = readText('shared/domain/sync-engine.md')

  assert.match(auth, /token lifecycle/i)
  assert.match(auth, /device registration/i)
  assert.match(ws, /reconnect/i)
  assert.match(ws, /event dispatch/i)
  assert.match(sync, /outbox/i)
  assert.match(sync, /retry/i)
})

test('protocol versioning document defines backward compatibility rules', () => {
  const content = readText('shared/protocol/versioning.md')

  assert.match(content, /backward compatibility/i)
  assert.match(content, /minor/i)
  assert.match(content, /breaking/i)
})

test('rest schema defines auth, chats, keys and media contracts', () => {
  const schema = readJson('shared/protocol/rest-schema.json')

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.type, 'object')
  assert.ok(schema.$defs)
  assert.ok(schema.$defs.authRegisterRequest)
  assert.ok(schema.$defs.deviceBundle)
  assert.ok(schema.properties.endpoints)
})

test('ws schema defines inbound and outbound frame unions', () => {
  const schema = readJson('shared/protocol/ws-schema.json')

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.type, 'object')
  assert.ok(schema.$defs)
  assert.ok(schema.$defs.serverFrame)
  assert.ok(schema.$defs.clientFrame)
  assert.ok(schema.$defs.frameType)
  assert.ok(schema.$defs.messageRecipient)
})

test('message envelope schema defines direct and group encrypted payload shapes', () => {
  const schema = readJson('shared/protocol/message-envelope.schema.json')

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.type, 'object')
  assert.ok(schema.$defs)
  assert.ok(schema.$defs.directMessageWirePayload)
  assert.ok(schema.$defs.groupMessageWirePayload)
  assert.ok(schema.$defs.mediaPayload)
  assert.ok(schema.$defs.envelopeVersion.enum.includes(1))
})

test('native core starter module manifest exists and references shared contracts', () => {
  const manifest = readJson('shared/native-core/module.json')
  const readme = readText('shared/native-core/README.md')

  assert.equal(manifest.name, 'shared-native-core')
  assert.equal(manifest.version, 1)
  assert.deepEqual(manifest.modules, ['auth', 'websocket', 'sync', 'crypto', 'storage', 'messages'])
  assert.deepEqual(manifest.dependsOn, ['shared/protocol', 'shared/domain', 'shared/crypto-contracts', 'shared/test-vectors'])
  assert.match(readme, /runtime/i)
  assert.match(readme, /protocol/i)
})

test('test vector manifest enumerates required crypto suites', () => {
  const manifest = readJson('shared/test-vectors/manifest.json')

  assert.equal(manifest.version, 1)
  assert.deepEqual(
    manifest.vectors.map((entry) => entry.id),
    ['x3dh-handshake', 'double-ratchet-sequence', 'sender-key-group'],
  )
})

test('each crypto vector includes metadata, inputs and expected invariants', () => {
  const vectorFiles = [
    'shared/test-vectors/x3dh-handshake-vector.json',
    'shared/test-vectors/double-ratchet-sequence-vector.json',
    'shared/test-vectors/sender-key-group-vector.json',
  ]

  for (const file of vectorFiles) {
    const vector = readJson(file)

    assert.equal(typeof vector.id, 'string')
    assert.equal(typeof vector.purpose, 'string')
    assert.equal(Array.isArray(vector.inputs), true)
    assert.equal(Array.isArray(vector.expectedInvariants), true)
    assert.ok(vector.expectedInvariants.length > 0, `${file} must define invariants`)
  }
})
