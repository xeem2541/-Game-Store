-- Gameplay: เช็คพอยต์ ซุ้มประตู จุดเสกรถ แผ่นบูสต์ ผู้เล่น (ModuleScript ชื่อ Gameplay)
return function(ctx)
	local Config, Util, F, Car = ctx.Config, ctx.Util, ctx.F, ctx.Car
	local part = Util.part
	local Players = game:GetService("Players")
	local ZONES, TOTAL, ROAD_WIDTH = Config.ZONES, Config.TOTAL, Config.ROAD_WIDTH
	local frame, baseY = Config.frame, Config.baseY

	local checkpoints = {} -- [i] = { cf, zone }
	local state = {} -- [player] = { progress }
	checkpoints[0] = { cf = frame(20) * CFrame.new(0, 3.2, 0), zone = 1 }

	-- นับจำนวนเช็คพอยต์ (ไม่รวมเส้นชัย)
	local cpCount = 0
	for t = Config.CHECKPOINT_EVERY, TOTAL - 100, Config.CHECKPOINT_EVERY do
		cpCount = cpCount + 1
	end
	local FINISH = cpCount + 1

	function ctx.getCheckpointCF(player)
		local st = state[player]
		return checkpoints[st and st.progress or 0].cf
	end

	local function playerFromPart(hit)
		local model = hit:FindFirstAncestorOfClass("Model")
		if not model then
			return nil
		end
		local uid = model:GetAttribute("OwnerUserId")
		if uid then
			return Players:GetPlayerByUserId(uid)
		end
		return Players:GetPlayerFromCharacter(model)
	end

	local function setProgress(player, idx)
		local st = state[player]
		if not st then
			return
		end
		st.progress = idx
		local zone = ZONES[checkpoints[idx].zone]
		player:SetAttribute("Zone", zone.name)
		player:SetAttribute("ZoneThai", zone.thai)
		player:SetAttribute("Checkpoint", idx)
		local ls = player:FindFirstChild("leaderstats")
		if ls then
			ls.Checkpoint.Value = idx
		end
	end

	local function gateSign(text, size, cf, accent)
		local sign = part(F.gates, size, cf, Color3.fromRGB(25, 25, 30))
		for _, face in ipairs({ Enum.NormalId.Front, Enum.NormalId.Back }) do
			local gui = Instance.new("SurfaceGui")
			gui.Face = face
			gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
			gui.PixelsPerStud = 30
			gui.Parent = sign
			local l = Instance.new("TextLabel")
			l.Size = UDim2.fromScale(1, 1)
			l.BackgroundTransparency = 1
			l.TextScaled = true
			l.Font = Enum.Font.GothamBold
			l.Text = text
			l.TextColor3 = accent
			l.Parent = gui
		end
	end

	local WHITE = Color3.fromRGB(235, 235, 240)
	local function buildGate(t, label, accent, onTouch)
		local base = frame(t)
		local half = ROAD_WIDTH / 2 + 2.5
		for _, s in ipairs({ -1, 1 }) do
			part(F.gates, Vector3.new(2.5, 18, 2.5), base * CFrame.new(s * half, 8, 0), WHITE, Enum.Material.Metal)
		end
		part(F.gates, Vector3.new(half * 2 + 2.5, 3, 3), base * CFrame.new(0, 17.5, 0), WHITE, Enum.Material.Metal)
		part(F.gates, Vector3.new(half * 2, 0.5, 0.5), base * CFrame.new(0, 15.7, 0), accent, Enum.Material.Neon)
		gateSign(label, Vector3.new(half * 1.5, 6, 0.6), base * CFrame.new(0, 22, 0), accent)

		local trigger = part(F.gates, Vector3.new(ROAD_WIDTH + 6, 26, 4), base * CFrame.new(0, 13, 0), accent)
		trigger.Name = "Trigger"
		trigger.Transparency = 1
		trigger.CanCollide = false
		trigger.Touched:Connect(function(hit)
			local player = playerFromPart(hit)
			if player then
				onTouch(player)
			end
		end)
	end

	local function buildSpawnPad(cf, text)
		local pad = part(F.pads, Vector3.new(10, 0.5, 10), cf, Color3.fromRGB(60, 255, 120), Enum.Material.Neon)
		pad.Name = "CarSpawnPad"
		part(F.pads, Vector3.new(11, 0.3, 11), cf * CFrame.new(0, -0.1, 0), Color3.fromRGB(20, 20, 25),
			Enum.Material.Metal).CanCollide = false

		local board = Instance.new("BillboardGui")
		board.Size = UDim2.fromOffset(180, 40)
		board.StudsOffset = Vector3.new(0, 4, 0)
		board.MaxDistance = 120
		board.Parent = pad
		local l = Instance.new("TextLabel")
		l.Size = UDim2.fromScale(1, 1)
		l.BackgroundTransparency = 1
		l.TextScaled = true
		l.Font = Enum.Font.GothamBold
		l.TextColor3 = Color3.new(1, 1, 1)
		l.TextStrokeTransparency = 0.3
		l.Text = text
		l.Parent = board

		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "เสกรถ"
		prompt.ObjectText = "Spawn Car"
		prompt.HoldDuration = 0.25
		prompt.MaxActivationDistance = 14
		prompt.RequiresLineOfSight = false
		prompt.Parent = pad
		prompt.Triggered:Connect(function(player)
			Car.spawn(player, ctx.getCheckpointCF(player))
		end)
	end

	-- จุดเสกรถที่ลานสตาร์ท
	buildSpawnPad(ctx.startFrame * CFrame.new(10, 0.1, 50), "🚗 เสกรถที่นี่")

	-- ซุ้มเช็คพอยต์
	local idx = 0
	for t = Config.CHECKPOINT_EVERY, TOTAL - 100, Config.CHECKPOINT_EVERY do
		idx = idx + 1
		local myIdx = idx
		local zi = Config.zoneIndexAt(t + 1)
		local zone = ZONES[zi]
		checkpoints[myIdx] = { cf = frame(t + 25) * CFrame.new(0, 3.2, 0), zone = zi }

		local label = string.format("CHECKPOINT %d", myIdx)
		if t % Config.ZONE_LENGTH == 0 then
			label = string.format("ZONE %d · %s\n%s", zi, string.upper(zone.name), zone.thai)
		end
		buildGate(t, label, zone.accent, function(player)
			local st = state[player]
			if st and myIdx > st.progress then
				setProgress(player, myIdx)
				player:SetAttribute("Toast", string.format("✅ เช็คพอยต์ %d/%d · %s", myIdx, FINISH, zone.thai))
			end
		end)

		local lat = ROAD_WIDTH / 2 + 12
		local side = frame(t, lat)
		buildSpawnPad(CFrame.new(side.X, baseY(t, lat) + 0.25, side.Z) * frame(t).Rotation, "🚗 เสกรถ")
	end

	-- เส้นชัย
	checkpoints[FINISH] = { cf = frame(TOTAL - 20) * CFrame.new(0, 3.2, 0), zone = #ZONES }
	buildGate(TOTAL - 20, "🏁 FINISH", Color3.new(1, 1, 1), function(player)
		local st = state[player]
		if st and st.progress > 0 then
			local ls = player:FindFirstChild("leaderstats")
			if ls then
				ls.Trips.Value = ls.Trips.Value + 1
			end
			player:SetAttribute("Toast", "🏁 ถึงปลายทางแล้ว! ทริปสำเร็จ เริ่มทริปใหม่ได้เลย")
			setProgress(player, 0)
		end
	end)

	-- แผ่นบูสต์
	local k = 0
	for t = 250, TOTAL - 300, Config.BOOST_EVERY do
		k = k + 1
		local lane = ((k % 3) - 1) * 10
		local padCF = frame(t, lane) * CFrame.new(0, 0.15, 0)
		local pad = part(F.boost, Vector3.new(12, 0.25, 16), padCF, Color3.fromRGB(10, 25, 45), Enum.Material.Metal)
		pad.Name = "BoostPad"
		pad.CanCollide = false
		for _, zoff in ipairs({ -4, 4 }) do
			for _, s in ipairs({ -1, 1 }) do
				part(F.boost, Vector3.new(1, 0.1, 6.2),
					padCF * CFrame.new(s * 2.1, 0.17, zoff - 0.9) * CFrame.Angles(0, s * math.rad(45), 0),
					Color3.fromRGB(0, 230, 255), Enum.Material.Neon).CanCollide = false
			end
		end
		pad.Touched:Connect(function(hit)
			local player = playerFromPart(hit)
			local car = player and Car.get(player)
			if car and hit:IsDescendantOf(car.model) then
				Car.boost(player)
			end
		end)
	end

	-- ผู้เล่น
	local function onPlayerAdded(player)
		state[player] = { progress = 0 }
		local ls = Instance.new("Folder")
		ls.Name = "leaderstats"
		local cp = Instance.new("IntValue")
		cp.Name = "Checkpoint"
		cp.Parent = ls
		local trips = Instance.new("IntValue")
		trips.Name = "Trips"
		trips.Parent = ls
		ls.Parent = player
		player:SetAttribute("CheckpointTotal", FINISH)
		setProgress(player, 0)

		player.CharacterAdded:Connect(function(char)
			local root = char:WaitForChild("HumanoidRootPart", 10)
			local st = state[player]
			if root and st and st.progress > 0 then
				task.wait()
				char:PivotTo(checkpoints[st.progress].cf * CFrame.new(0, 4, 0))
			end
		end)
	end
	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, p in ipairs(Players:GetPlayers()) do
		task.spawn(onPlayerAdded, p)
	end
	Players.PlayerRemoving:Connect(function(player)
		Car.destroy(player)
		state[player] = nil
	end)
end
