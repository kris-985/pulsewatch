import mongoose from 'mongoose'
import { Monitor } from '../src/modules/monitors/monitor.model.js'
import { Workspace } from '../src/modules/workspaces/workspace.model.js'
import {
  createMonitor,
  findMonitorById,
  findMonitorsByWorkspace,
  softDeleteMonitor,
  updateMonitor,
} from '../src/modules/monitors/monitor.repository.js'

const mongoTestUri = process.env.MONGODB_TEST_URI
const describeWithMongo = mongoTestUri ? describe : describe.skip

describeWithMongo('Monitor repository with MongoDB Replica Set', () => {
  const workspaceIds = new Set()

  async function createTestWorkspace() {
    const [workspace] = await Workspace.create([{
      ownerId: new mongoose.Types.ObjectId(),
      name: `Monitor integration ${new mongoose.Types.ObjectId()}`,
    }])
    workspaceIds.add(workspace._id)
    return workspace
  }

  async function createTestMonitor(workspaceId, overrides = {}) {
    return createMonitor(workspaceId, {
      name: 'Integration monitor',
      url: 'https://status.example.com',
      intervalSeconds: 60,
      ...overrides,
    })
  }

  beforeAll(async () => {
    await mongoose.connect(mongoTestUri, { serverSelectionTimeoutMS: 5_000 })
    const hello = await mongoose.connection.db.admin().command({ hello: 1 })
    if (hello.setName !== 'rs0' || hello.isWritablePrimary !== true) {
      throw new Error('MONGODB_TEST_URI must point to PRIMARY of replica set rs0')
    }
  }, 15_000)

  afterEach(async () => {
    const ids = [...workspaceIds]
    if (ids.length) {
      await Monitor.deleteMany({ workspaceId: { $in: ids } })
      await Workspace.deleteMany({ _id: { $in: ids } })
      workspaceIds.clear()
    }
  })

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
  })

  it('creates and reads a Monitor in its Workspace', async () => {
    const workspace = await createTestWorkspace()
    const created = await createTestMonitor(workspace._id)
    const found = await findMonitorById(workspace._id, created._id)

    expect(found).not.toBeNull()
    expect(String(found._id)).toBe(String(created._id))
    expect(String(found.workspaceId)).toBe(String(workspace._id))
    expect(found.name).toBe('Integration monitor')
  })

  it('does not find a Monitor through another Workspace', async () => {
    const ownerWorkspace = await createTestWorkspace()
    const otherWorkspace = await createTestWorkspace()
    const monitor = await createTestMonitor(ownerWorkspace._id)

    await expect(findMonitorById(otherWorkspace._id, monitor._id)).resolves.toBeNull()
  })

  it('persists updates to a Monitor in the owning Workspace', async () => {
    const workspace = await createTestWorkspace()
    const monitor = await createTestMonitor(workspace._id)

    const updated = await updateMonitor(workspace._id, monitor._id, {
      name: 'Updated integration monitor',
      intervalSeconds: 120,
    })
    const persisted = await Monitor.findById(monitor._id).lean()

    expect(updated.name).toBe('Updated integration monitor')
    expect(persisted.name).toBe('Updated integration monitor')
    expect(persisted.intervalSeconds).toBe(120)
  })

  it('soft deletes and omits the Monitor from standard reads', async () => {
    const workspace = await createTestWorkspace()
    const monitor = await createTestMonitor(workspace._id)

    const deleted = await softDeleteMonitor(workspace._id, monitor._id)

    expect(deleted.deletedAt).toBeInstanceOf(Date)
    await expect(findMonitorById(workspace._id, monitor._id)).resolves.toBeNull()
    await expect(findMonitorsByWorkspace(workspace._id)).resolves.toHaveLength(0)
    expect(await Monitor.findById(monitor._id).lean()).not.toBeNull()
  })

  it('paginates by cursor and excludes deleted records on subsequent pages', async () => {
    const workspace = await createTestWorkspace()
    const monitors = []
    for (let index = 1; index <= 5; index += 1) {
      monitors.push(await createTestMonitor(workspace._id, { name: `Page monitor ${index}` }))
    }

    const firstPage = await findMonitorsByWorkspace(workspace._id, { limit: 2 })
    expect(firstPage).toHaveLength(2)
    expect(String(firstPage[0]._id)).toBe(String(monitors[4]._id))
    expect(String(firstPage[1]._id)).toBe(String(monitors[3]._id))

    await softDeleteMonitor(workspace._id, firstPage[0]._id)
    const secondPage = await findMonitorsByWorkspace(workspace._id, {
      limit: 2,
      cursor: String(firstPage[1]._id),
    })

    expect(secondPage).toHaveLength(2)
    expect(secondPage.map((monitor) => monitor.name)).toEqual(['Page monitor 3', 'Page monitor 2'])
    expect(secondPage.some((monitor) => String(monitor._id) === String(firstPage[0]._id))).toBe(false)
  })
})
