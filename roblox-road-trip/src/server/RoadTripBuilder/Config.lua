-- โมดูล Config (ส่วนหนึ่งของ RoadTripBuilder) : ModuleScript ชื่อ Config
return function(S)
local ZONE_LENGTH = 1200 -- ความยาวต่อโซน (studs)
local STEP = 12 -- ความละเอียดของถนน (เล็ก = เนียนกว่า แต่ part เยอะกว่า)
local ROAD_WIDTH = 36
local CHECKPOINT_EVERY = 600
local BOOST_EVERY = 400

local CAR_MAX_SPEED = 130 -- studs/s (~36 km/h ต่อ 10 studs/s = 0.28 m/s)
local BOOST_MULT = 1.7
local BOOST_TIME = 3
local WHEEL_RADIUS = 1.5
local DRIVE_SIGN = 1 -- ถ้ารถวิ่งถอยหลังตอนกด W ให้เปลี่ยนเป็น -1
local STEER_SIGN = 1 -- ถ้าเลี้ยวผิดข้างให้เปลี่ยนเป็น -1

local ZONES = {
	{
		name = "City", thai = "เมือง",
		ground = Color3.fromRGB(105, 105, 110), groundMat = Enum.Material.Concrete,
		road = Color3.fromRGB(45, 45, 50), roadMat = Enum.Material.Asphalt,
		accent = Color3.fromRGB(255, 80, 200), lines = true, rails = false,
	},
	{
		name = "Grassland", thai = "ทุ่งหญ้า",
		ground = Color3.fromRGB(86, 150, 60), groundMat = Enum.Material.Grass,
		road = Color3.fromRGB(55, 55, 58), roadMat = Enum.Material.Asphalt,
		accent = Color3.fromRGB(120, 255, 100), lines = true, rails = false,
	},
	{
		name = "Mountain", thai = "ภูเขา",
		ground = Color3.fromRGB(112, 108, 104), groundMat = Enum.Material.Slate,
		road = Color3.fromRGB(60, 60, 65), roadMat = Enum.Material.Asphalt,
		accent = Color3.fromRGB(120, 200, 255), lines = true, rails = true,
	},
	{
		name = "Beach", thai = "ชายหาด",
		ground = Color3.fromRGB(238, 214, 160), groundMat = Enum.Material.Sand,
		road = Color3.fromRGB(95, 95, 100), roadMat = Enum.Material.Concrete,
		accent = Color3.fromRGB(255, 200, 60), lines = true, rails = true,
	},
	{
		name = "Camp", thai = "แคมป์",
		ground = Color3.fromRGB(70, 112, 50), groundMat = Enum.Material.Grass,
		road = Color3.fromRGB(122, 92, 62), roadMat = Enum.Material.Ground,
		accent = Color3.fromRGB(255, 140, 40), lines = false, rails = false,
	},
}

local TOTAL = ZONE_LENGTH * #ZONES
local rng = Random.new(2024)

----------------------------------------------------------------------
-- เส้นทางถนน
----------------------------------------------------------------------
local function zoneIndexAt(t)
	return math.clamp(math.floor(t / ZONE_LENGTH) + 1, 1, #ZONES)
end

local function heightAt(t)
	local zi = math.floor(t / ZONE_LENGTH)
	local u = (t - zi * ZONE_LENGTH) / ZONE_LENGTH
	if zi == 1 then -- ทุ่งหญ้า: เนินสลับขึ้นลงเบา ๆ
		return 8 * math.sin(math.pi * u) * math.sin(u * math.pi * 6)
	elseif zi == 2 then -- ภูเขา: ไต่ขึ้นแล้วลง
		return 140 * math.sin(math.pi * u) ^ 2
	end
	return 0
end

local function lateralAt(t)
	return 90 * math.sin(t / 500) + 40 * math.sin(t / 260)
end

local function pointAt(t)
	return Vector3.new(t, heightAt(t) + 0.5, lateralAt(t))
end

-- CFrame ที่กึ่งกลางถนน (ผิวถนน) หันไปตามทิศถนน (หมุนเฉพาะแกน Y), offset ด้านข้างได้
local function frame(t, lateral)
	local d = pointAt(t + 1) - pointAt(math.max(t - 1, 0))
	local yaw = math.atan2(-d.X, -d.Z)
	return CFrame.new(pointAt(t)) * CFrame.Angles(0, yaw, 0) * CFrame.new(lateral or 0, 0, 0)
end

-- ความสูงพื้นที่ข้างถนน (ไหล่ทางยกตามถนน, ไกลออกไปเป็นพื้นราบ)
local function baseY(t, lateral)
	if math.abs(lateral) < 34 then
		return math.max(0, pointAt(t).Y - 1.1)
	end
	return 0
end

local function placeAt(t, lateral)
	local f = frame(t, lateral)
	return CFrame.new(f.X, baseY(t, lateral), f.Z) * f.Rotation
end

----------------------------------------------------------------------
-- ตัวช่วยสร้าง Part
----------------------------------------------------------------------
local function part(parent, size, cf, color, material, shape)
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
local function vcyl(parent, pos, height, diameter, color, material)
	return part(
		parent,
		Vector3.new(height, diameter, diameter),
		CFrame.new(pos + Vector3.new(0, height / 2, 0)) * CFrame.Angles(0, 0, math.pi / 2),
		color, material, Enum.PartType.Cylinder
	)
end

local function rand(a, b)
	return rng:NextNumber(a, b)
end


S.zoneIndexAt = zoneIndexAt
S.heightAt = heightAt
S.lateralAt = lateralAt
S.pointAt = pointAt
S.frame = frame
S.baseY = baseY
S.placeAt = placeAt
S.part = part
S.vcyl = vcyl
S.rand = rand
S.ZONE_LENGTH = ZONE_LENGTH
S.STEP = STEP
S.ROAD_WIDTH = ROAD_WIDTH
S.CHECKPOINT_EVERY = CHECKPOINT_EVERY
S.BOOST_EVERY = BOOST_EVERY
S.CAR_MAX_SPEED = CAR_MAX_SPEED
S.BOOST_MULT = BOOST_MULT
S.BOOST_TIME = BOOST_TIME
S.WHEEL_RADIUS = WHEEL_RADIUS
S.DRIVE_SIGN = DRIVE_SIGN
S.STEER_SIGN = STEER_SIGN
S.ZONES = ZONES
S.TOTAL = TOTAL
S.rng = rng
end
