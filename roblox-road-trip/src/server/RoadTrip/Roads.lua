-- Roads: พื้น ถนน ลานสตาร์ท จุดเกิด แสง (ModuleScript ชื่อ Roads)
return function(ctx)
	local Config, Util, F = ctx.Config, ctx.Util, ctx.F
	local part = Util.part
	local ZONES, TOTAL, STEP, ROAD_WIDTH = Config.ZONES, Config.TOTAL, Config.STEP, Config.ROAD_WIDTH
	local pointAt, frame = Config.pointAt, Config.frame
	local Lighting = game:GetService("Lighting")

	-- บรรยากาศ
	Lighting.ClockTime = 14.5
	Lighting.Brightness = 3
	Lighting.Ambient = Color3.fromRGB(110, 110, 120)
	if not Lighting:FindFirstChildOfClass("Atmosphere") then
		local atm = Instance.new("Atmosphere")
		atm.Density = 0.25
		atm.Offset = 0.25
		atm.Color = Color3.fromRGB(199, 215, 235)
		atm.Parent = Lighting
	end

	-- พื้นแต่ละโซน
	for i, z in ipairs(ZONES) do
		local cx = (i - 1) * Config.ZONE_LENGTH + Config.ZONE_LENGTH / 2
		if z.name == "Beach" then
			part(F.ground, Vector3.new(Config.ZONE_LENGTH + 4, 6, 1160), CFrame.new(cx, -3, -320), z.ground, z.groundMat)
			local water = part(F.ground, Vector3.new(Config.ZONE_LENGTH + 4, 7.4, 740), CFrame.new(cx, -4.3, 630),
				Color3.fromRGB(40, 150, 220), Enum.Material.Glass)
			water.Transparency = 0.35
			water.CanCollide = false
			part(F.ground, Vector3.new(Config.ZONE_LENGTH + 4, 2, 740), CFrame.new(cx, -9, 630),
				Color3.fromRGB(230, 205, 150), Enum.Material.Sand)
		else
			part(F.ground, Vector3.new(Config.ZONE_LENGTH + 4, 6, 1800), CFrame.new(cx, -3, 0), z.ground, z.groundMat)
		end
	end

	-- ถนนทีละช่วง
	local WHITE = Color3.fromRGB(240, 240, 240)
	local YELLOW = Color3.fromRGB(255, 220, 60)
	for t = 0, TOTAL - STEP, STEP do
		if (t / STEP) % 25 == 0 then
			task.wait()
		end
		local a, b = pointAt(t), pointAt(t + STEP)
		local zone = ZONES[Config.zoneIndexAt(t + STEP / 2)]
		local mid, len = (a + b) / 2, (b - a).Magnitude
		local cf = CFrame.lookAt(mid, b)

		part(F.road, Vector3.new(ROAD_WIDTH, 1.2, len + 0.6), cf * CFrame.new(0, -0.6, 0), zone.road, zone.roadMat)

		local slab = part(F.road, Vector3.new(70, 3, len + 0.6), cf * CFrame.new(0, -2.6, 0), zone.ground, zone.groundMat)
		if zone.name == "Mountain" then
			slab.Color = Color3.fromRGB(100, 96, 92)
			slab.Material = Enum.Material.Rock
		end
		local colH = mid.Y - 3.5
		if colH > 2 then
			local flat = CFrame.lookAt(Vector3.new(mid.X, 0, mid.Z), Vector3.new(b.X, 0, b.Z))
			part(F.road, Vector3.new(28, colH, len + 0.6), flat * CFrame.new(0, colH / 2, 0),
				Color3.fromRGB(95, 92, 88), Enum.Material.Rock)
		end

		if zone.lines then
			for _, s in ipairs({ -1, 1 }) do
				local edge = part(F.road, Vector3.new(0.6, 0.12, len + 0.6),
					cf * CFrame.new(s * (ROAD_WIDTH / 2 - 1.2), 0.04, 0), WHITE)
				edge.CanCollide = false
			end
			if (t / STEP) % 2 == 0 then
				local dash = part(F.road, Vector3.new(0.8, 0.12, len * 0.9), cf * CFrame.new(0, 0.04, 0), YELLOW)
				dash.CanCollide = false
			end
		end
		if zone.rails then
			for _, s in ipairs({ -1, 1 }) do
				part(F.road, Vector3.new(0.7, 1.8, len + 0.6), cf * CFrame.new(s * (ROAD_WIDTH / 2 + 0.5), 0.9, 0),
					Color3.fromRGB(200, 200, 205), Enum.Material.Metal)
			end
		end
	end

	-- ลานสตาร์ท + จุดเกิด
	local startFrame = frame(0)
	ctx.startFrame = startFrame
	part(F.road, Vector3.new(130, 1, 120), startFrame * CFrame.new(0, -0.7, 65),
		Color3.fromRGB(70, 70, 76), Enum.Material.Concrete).Name = "StartPlaza"

	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "RoadTripSpawn"
	spawn.Anchored = true
	spawn.Neutral = true
	spawn.Duration = 0
	spawn.Size = Vector3.new(10, 1, 10)
	spawn.CFrame = startFrame * CFrame.new(-30, 0.1, 50)
	spawn.Transparency = 0.2
	spawn.Parent = ctx.world
	ctx.spawn = spawn

	-- ลานปลายทาง
	part(F.road, Vector3.new(150, 1, 140), frame(TOTAL) * CFrame.new(0, -0.7, -70),
		Color3.fromRGB(122, 92, 62), Enum.Material.Ground)
end
