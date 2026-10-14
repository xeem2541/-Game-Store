-- Config: ค่าตั้งต้น + สูตรเส้นทางถนน (ModuleScript ชื่อ Config)
local Config = {}

Config.ZONE_LENGTH = 1200 -- ความยาวต่อโซน (studs)
Config.STEP = 12 -- ความละเอียดถนน (เล็ก = เนียน แต่ part เยอะ)
Config.ROAD_WIDTH = 36
Config.CHECKPOINT_EVERY = 600
Config.BOOST_EVERY = 400

-- ค่ารถ (หน่วย studs, วินาที)
Config.CAR = {
	MaxSpeed = 140, -- ความเร็วสูงสุด
	Accel = 70, -- อัตราเร่ง
	BrakeAccel = 110, -- เบรก
	ReverseSpeed = 35, -- ความเร็วถอยสูงสุด
	Grip = 7, -- แรงเกาะข้าง (มาก = ไม่ไถล)
	TurnRate = 1.8, -- อัตราเลี้ยวสูงสุด rad/s
	BoostMult = 1.6, -- คูณความเร็ว/เร่งตอนบูสต์
	BoostTime = 3, -- วินาที
	BoostKick = 35, -- ดีดความเร็วตอนเหยียบแผ่น
}

Config.ZONES = {
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

Config.TOTAL = Config.ZONE_LENGTH * #Config.ZONES

function Config.zoneIndexAt(t)
	return math.clamp(math.floor(t / Config.ZONE_LENGTH) + 1, 1, #Config.ZONES)
end

-- ความสูงถนน: ทุ่งหญ้าเป็นเนิน, ภูเขาไต่ขึ้นแล้วลง, ที่เหลือราบ
function Config.heightAt(t)
	local zi = math.floor(t / Config.ZONE_LENGTH)
	local u = (t - zi * Config.ZONE_LENGTH) / Config.ZONE_LENGTH
	if zi == 1 then
		return 8 * math.sin(math.pi * u) * math.sin(u * math.pi * 6)
	elseif zi == 2 then
		return 140 * math.sin(math.pi * u) ^ 2
	end
	return 0
end

function Config.lateralAt(t)
	return 90 * math.sin(t / 500) + 40 * math.sin(t / 260)
end

function Config.pointAt(t)
	return Vector3.new(t, Config.heightAt(t) + 0.5, Config.lateralAt(t))
end

-- CFrame กลางถนน (ผิวถนน) หันตามทิศถนน หมุนเฉพาะแกน Y
function Config.frame(t, lateral)
	local d = Config.pointAt(t + 1) - Config.pointAt(math.max(t - 1, 0))
	local yaw = math.atan2(-d.X, -d.Z)
	return CFrame.new(Config.pointAt(t)) * CFrame.Angles(0, yaw, 0) * CFrame.new(lateral or 0, 0, 0)
end

-- ความสูงพื้นข้างถนน (ไหล่ยกตามถนน ไกลออกไปราบ)
function Config.baseY(t, lateral)
	if math.abs(lateral) < 34 then
		return math.max(0, Config.pointAt(t).Y - 1.1)
	end
	return 0
end

function Config.placeAt(t, lateral)
	local f = Config.frame(t, lateral)
	return CFrame.new(f.X, Config.baseY(t, lateral), f.Z) * f.Rotation
end

return Config
