/**
 * Member management API routes (US-007)
 *
 * Replaces the Electron IPC handlers for member management:
 *   GET    /api/sessions/:id/members           - all members with stats
 *   GET    /api/sessions/:id/members/paginated  - paginated members
 *   PATCH  /api/sessions/:id/members/:memberId/aliases - update aliases
 *   DELETE /api/sessions/:id/members/:memberId  - delete member
 */

import { Router } from 'express'
import {
  getMembers,
  getMembersPaginated,
  updateMemberAliases,
  deleteMember,
  closeDatabase,
} from '../services/queries'

const router = Router({ mergeParams: true })

/**
 * GET /api/sessions/:id/members - all members with stats
 */
router.get('/:id/members', (req, res) => {
  try {
    const members = getMembers(req.params.id)
    res.json(members)
  } catch (error) {
    console.error('[API] Failed to get members:', error)
    res.status(500).json({ error: 'Failed to get members' })
  }
})

/**
 * GET /api/sessions/:id/members/paginated - paginated members
 *
 * Query params: page, pageSize, search, sortOrder
 */
router.get('/:id/members/paginated', (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 20
    const search = (req.query.search as string) || ''
    const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' as const : 'desc' as const

    const result = getMembersPaginated(req.params.id, {
      page,
      pageSize,
      search,
      sortOrder,
    })
    res.json(result)
  } catch (error) {
    console.error('[API] Failed to get paginated members:', error)
    res.status(500).json({ error: 'Failed to get paginated members' })
  }
})

/**
 * PATCH /api/sessions/:id/members/:memberId/aliases - update member aliases
 */
router.patch('/:id/members/:memberId/aliases', (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId)
    if (isNaN(memberId)) {
      res.status(400).json({ error: 'Invalid memberId' })
      return
    }

    const { aliases } = req.body
    if (!Array.isArray(aliases)) {
      res.status(400).json({ error: 'aliases must be an array' })
      return
    }

    // Close pooled connection so the writable open inside updateMemberAliases works
    closeDatabase(req.params.id)
    const success = updateMemberAliases(req.params.id, memberId, aliases)
    res.json({ success })
  } catch (error) {
    console.error('[API] Failed to update member aliases:', error)
    res.status(500).json({ error: 'Failed to update member aliases', success: false })
  }
})

/**
 * DELETE /api/sessions/:id/members/:memberId - delete member
 */
router.delete('/:id/members/:memberId', (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId)
    if (isNaN(memberId)) {
      res.status(400).json({ error: 'Invalid memberId' })
      return
    }

    // Close pooled connection so the writable open inside deleteMember works
    closeDatabase(req.params.id)
    const success = deleteMember(req.params.id, memberId)
    res.json({ success })
  } catch (error) {
    console.error('[API] Failed to delete member:', error)
    res.status(500).json({ error: 'Failed to delete member', success: false })
  }
})

export default router
