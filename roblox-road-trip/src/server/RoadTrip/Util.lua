-- Util: ตัวช่วยสร้าง Part (ModuleScript ชื่อ Util)
local Util = {}

Util.rng = Random.new(2024)

function Util.rand(a, b)
	return Util.rng:NextNumber(a, b)
end

function Util.part(parent, size, cf, color, material, shape)
	local p = Instance.new("Part")
	p.Anchored = true
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Material = material or Enum.Material.SmoothPlastic
	if shape then
		p.Shape = shape
	end
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

-- ทรงกระบอกตั้งตรง ฐานอยู่ที่ pos
function Util.vcyl(parent, pos, height, diameter, color, material)
	return Util.part(
		parent,
		Vector3.new(height, diameter, diameter),
		CFrame.new(pos + Vector3.new(0, height / 2, 0)) * CFrame.Angles(0, 0, math.pi / 2),
		color, material, Enum.PartType.Cylinder
	)
end

function Util.folder(parent, name)
	local f = Instance.new("Folder")
	f.Name = name
	f.Parent = parent
	return f
end

return Util
