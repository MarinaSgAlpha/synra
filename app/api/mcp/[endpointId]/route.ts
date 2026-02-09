import { NextRequest, NextResponse } from 'next/server'

// MCP Gateway endpoint - the core product
// GET: Returns available MCP tools
// POST: Executes tool request against user's database
// To be implemented in Task 6

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  const { endpointId } = await params
  
  // Placeholder - will implement in Task 6
  return NextResponse.json({
    error: 'MCP gateway not yet implemented',
    endpointId,
  }, { status: 501 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> }
) {
  const { endpointId } = await params
  
  // Placeholder - will implement in Task 6
  return NextResponse.json({
    error: 'MCP gateway not yet implemented',
    endpointId,
  }, { status: 501 })
}
